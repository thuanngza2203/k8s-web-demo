require("dotenv").config();

const fs = require("fs");
const https = require("https");
const express = require("express");

const app = express();
const PORT = parseInt(process.env.PORT || "8082", 10);
const NAMESPACE =
  process.env.K8S_NAMESPACE || process.env.POD_NAMESPACE || "cloud-web-k8s";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const LOG_TAIL_LINES = parseInt(process.env.LOG_TAIL_LINES || "80", 10);
const LOG_SINCE_SECONDS = parseInt(process.env.LOG_SINCE_SECONDS || "1400", 10);
const TELEGRAM_MESSAGE_MAX_CHARS = parseInt(
  process.env.TELEGRAM_MESSAGE_MAX_CHARS || "3900",
  10,
);
const GEMINI_TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || "0.2");
const GEMINI_MAX_OUTPUT_TOKENS = parseInt(
  process.env.GEMINI_MAX_OUTPUT_TOKENS || "1200",
  10,
);
const AI_ANALYSIS_WORD_LIMIT = parseInt(
  process.env.AI_ANALYSIS_WORD_LIMIT || "100",
  10,
);
const AI_ANALYSIS_MAX_CHARS = parseInt(
  process.env.AI_ANALYSIS_MAX_CHARS || "1400",
  10,
);
const AI_ANALYSIS_ENABLED = parseBool(
  process.env.AI_ANALYSIS_ENABLED || "true",
);
const TELEGRAM_INCLUDE_LOG_SAMPLE = parseBool(
  process.env.TELEGRAM_INCLUDE_LOG_SAMPLE || "false",
);
const TELEGRAM_ALERT_COOLDOWN_SECONDS = parseInt(
  process.env.TELEGRAM_ALERT_COOLDOWN_SECONDS || "1800",
  10,
);
const TELEGRAM_NOTIFY_LABEL =
  process.env.TELEGRAM_NOTIFY_LABEL || "notify_telegram";
const TELEGRAM_ALLOWED_ALERTS = parseCsv(
  process.env.TELEGRAM_ALLOWED_ALERTS ||
    "API Down,High API Error Rate,Pod High Memory,Pod High CPU,Deployment Unavailable",
);
const OUTBOUND_FETCH_TIMEOUT_MS = parseInt(
  process.env.OUTBOUND_FETCH_TIMEOUT_MS || "20000",
  10,
);
const OUTBOUND_FETCH_ATTEMPTS = parseInt(
  process.env.OUTBOUND_FETCH_ATTEMPTS || "3",
  10,
);
const lastSentAtByAlertKey = new Map();

const SERVICEACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const K8S_TOKEN_PATH = `${SERVICEACCOUNT_DIR}/token`;
const K8S_CA_PATH = `${SERVICEACCOUNT_DIR}/ca.crt`;

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "alert-ai" });
});

app.get("/ready", (_req, res) => {
  res.json({
    status: "ready",
    geminiConfigured: hasValue(process.env.GEMINI_API_KEY),
    telegramConfigured:
      hasValue(process.env.TELEGRAM_BOT_TOKEN) &&
      hasValue(process.env.TELEGRAM_CHAT_ID),
    geminiModel: GEMINI_MODEL,
    geminiMaxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    aiAnalysisWordLimit: AI_ANALYSIS_WORD_LIMIT,
    aiAnalysisMaxChars: AI_ANALYSIS_MAX_CHARS,
    telegramIncludeLogSample: TELEGRAM_INCLUDE_LOG_SAMPLE,
    telegramAlertCooldownSeconds: TELEGRAM_ALERT_COOLDOWN_SECONDS,
    telegramAllowedAlerts: TELEGRAM_ALLOWED_ALERTS,
    outboundFetchTimeoutMs: OUTBOUND_FETCH_TIMEOUT_MS,
    outboundFetchAttempts: OUTBOUND_FETCH_ATTEMPTS,
  });
});

app.post("/grafana-alert", (req, res) => {
  res.status(202).json({ accepted: true });

  handleGrafanaWebhook(req.body).catch((err) => {
    console.error("[alert-ai] Failed to process Grafana webhook:", err);
  });
});

async function handleGrafanaWebhook(payload) {
  const alerts =
    Array.isArray(payload.alerts) && payload.alerts.length > 0
      ? payload.alerts
      : [payload];

  for (const alert of alerts) {
    const context = normalizeAlert(payload, alert);

    if (!shouldSendTelegram(context)) {
      console.log(
        `[alert-ai] Skipping Telegram notification for ${getAlertName(context)}.`,
      );
      continue;
    }

    if (isSuppressedByCooldown(context)) {
      console.log(
        `[alert-ai] Suppressing duplicate Telegram notification for ${getAlertName(context)}.`,
      );
      continue;
    }

    const logs = TELEGRAM_INCLUDE_LOG_SAMPLE
      ? await collectLogsForAlert(context)
      : [];
    const analysis = AI_ANALYSIS_ENABLED
      ? await analyzeWithGemini(context, logs)
      : "";
    const message = buildTelegramMessage(context, analysis, logs);
    console.log(
      `[alert-ai] Sending Telegram notification for ${getAlertName(context)}.`,
    );
    await sendTelegramMessage(message);
    console.log(
      `[alert-ai] Telegram notification sent for ${getAlertName(context)}.`,
    );
    markAlertSent(context);
  }
}

function normalizeAlert(payload, alert) {
  const labels = {
    ...(payload.groupLabels || {}),
    ...(payload.commonLabels || {}),
    ...(alert.labels || {}),
  };
  const annotations = {
    ...(payload.commonAnnotations || {}),
    ...(alert.annotations || {}),
  };

  return {
    status: alert.status || payload.status || "unknown",
    title: alert.title || labels.alertname || payload.title || "Grafana Alert",
    labels,
    annotations,
    values: alert.values || payload.values || {},
    valueString: alert.valueString || payload.valueString || "",
    startsAt: alert.startsAt || payload.startsAt || "",
    endsAt: alert.endsAt || payload.endsAt || "",
    generatorURL: alert.generatorURL || payload.generatorURL || "",
    dashboardURL: alert.dashboardURL || payload.dashboardURL || "",
    panelURL: alert.panelURL || payload.panelURL || "",
    externalURL: payload.externalURL || process.env.GRAFANA_EXTERNAL_URL || "",
  };
}

async function collectLogsForAlert(context) {
  const selectors = inferLogSelectors(context);
  const results = [];

  for (const selector of selectors) {
    try {
      const pods = selector.pod
        ? [{ metadata: { name: selector.pod }, spec: {} }]
        : await listPods(selector.labelSelector);

      for (const pod of pods.slice(0, selector.maxPods || 2)) {
        const podName = pod.metadata && pod.metadata.name;
        if (!podName) {
          continue;
        }

        const containerNames = getContainerNames(pod);
        const containersToRead =
          containerNames.length > 0 ? containerNames.slice(0, 2) : [undefined];

        for (const containerName of containersToRead) {
          const text = await readPodLogs(podName, containerName);
          if (text.trim()) {
            results.push({
              pod: podName,
              container: containerName || "default",
              text: trimText(text, 6000),
            });
          }
        }
      }
    } catch (err) {
      results.push({
        pod: selector.pod || selector.labelSelector || "unknown",
        container: "unknown",
        text: `Could not read logs: ${err.message}`,
      });
    }
  }

  return results.slice(0, 6);
}

function shouldSendTelegram(context) {
  const labels = context.labels || {};
  const labelValue = String(labels[TELEGRAM_NOTIFY_LABEL] || "")
    .trim()
    .toLowerCase();

  if (["true", "1", "yes", "on"].includes(labelValue)) {
    return true;
  }

  return TELEGRAM_ALLOWED_ALERTS.includes(getAlertName(context));
}

function isSuppressedByCooldown(context) {
  if (TELEGRAM_ALERT_COOLDOWN_SECONDS <= 0 || context.status === "resolved") {
    return false;
  }

  const key = getAlertDedupeKey(context);
  const lastSentAt = lastSentAtByAlertKey.get(key) || 0;
  return Date.now() - lastSentAt < TELEGRAM_ALERT_COOLDOWN_SECONDS * 1000;
}

function markAlertSent(context) {
  lastSentAtByAlertKey.set(getAlertDedupeKey(context), Date.now());
}

function getAlertDedupeKey(context) {
  const labels = context.labels || {};
  return [
    getAlertName(context),
    labels.pod ||
      labels.deployment ||
      labels.app ||
      labels.instance ||
      labels.team ||
      "global",
    context.status || "unknown",
  ].join("|");
}

function getAlertName(context) {
  return (
    (context.labels && context.labels.alertname) ||
    context.title ||
    "Grafana Alert"
  );
}

function inferLogSelectors(context) {
  const labels = context.labels || {};
  const title =
    `${context.title || ""} ${labels.alertname || ""}`.toLowerCase();

  if (labels.pod) {
    return [{ pod: labels.pod, maxPods: 1 }];
  }

  if (labels.app) {
    return [{ labelSelector: `app=${labels.app}`, maxPods: 2 }];
  }

  if (
    title.includes("database") ||
    title.includes("mysql") ||
    title.includes("db")
  ) {
    return [
      { labelSelector: "app=api", maxPods: 2 },
      { labelSelector: "app=mysql", maxPods: 1 },
    ];
  }

  if (title.includes("frontend")) {
    return [{ labelSelector: "app=frontend", maxPods: 2 }];
  }

  if (
    title.includes("api") ||
    title.includes("latency") ||
    title.includes("error")
  ) {
    return [{ labelSelector: "app=api", maxPods: 3 }];
  }

  if (
    title.includes("cpu") ||
    title.includes("memory") ||
    title.includes("pod")
  ) {
    return [
      { labelSelector: "app=api", maxPods: 1 },
      { labelSelector: "app=frontend", maxPods: 1 },
      { labelSelector: "app=mysql", maxPods: 1 },
    ];
  }

  return [
    { labelSelector: "app=api", maxPods: 1 },
    { labelSelector: "app=frontend", maxPods: 1 },
  ];
}

async function listPods(labelSelector) {
  const query = labelSelector
    ? `?labelSelector=${encodeURIComponent(labelSelector)}`
    : "";
  const data = await kubernetesRequest(
    `/api/v1/namespaces/${NAMESPACE}/pods${query}`,
  );
  return Array.isArray(data.items) ? data.items : [];
}

async function readPodLogs(podName, containerName) {
  const params = new URLSearchParams({
    tailLines: String(LOG_TAIL_LINES),
    sinceSeconds: String(LOG_SINCE_SECONDS),
    timestamps: "true",
  });

  if (containerName) {
    params.set("container", containerName);
  }

  return kubernetesRequest(
    `/api/v1/namespaces/${NAMESPACE}/pods/${encodeURIComponent(podName)}/log?${params}`,
    {
      rawText: true,
    },
  );
}

function getContainerNames(pod) {
  return (((pod || {}).spec || {}).containers || [])
    .map((container) => container.name)
    .filter(Boolean);
}

function kubernetesRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port =
      process.env.KUBERNETES_SERVICE_PORT_HTTPS ||
      process.env.KUBERNETES_SERVICE_PORT ||
      "443";

    if (!host || !fs.existsSync(K8S_TOKEN_PATH)) {
      reject(new Error("Kubernetes service account is not available"));
      return;
    }

    const token = fs.readFileSync(K8S_TOKEN_PATH, "utf8").trim();
    const requestOptions = {
      hostname: host,
      port,
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    if (fs.existsSync(K8S_CA_PATH)) {
      requestOptions.ca = fs.readFileSync(K8S_CA_PATH);
    }

    const req = https.request(requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(
              `Kubernetes API returned ${res.statusCode}: ${body.slice(0, 300)}`,
            ),
          );
          return;
        }

        if (options.rawText) {
          resolve(body);
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(
            new Error(
              `Could not parse Kubernetes API response: ${err.message}`,
            ),
          );
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

async function analyzeWithGemini(context, logs) {
  if (!hasValue(process.env.GEMINI_API_KEY)) {
    console.warn(
      "[alert-ai] Gemini analysis skipped because GEMINI_API_KEY is not configured.",
    );
    return "";
  }

  const prompt = buildGeminiPrompt(context, logs);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: [
                "You are an on-call SRE assistant.",
                "Analyze Kubernetes application logs for a Grafana alert.",
                "Respond in Vietnamese.",
                "Be concise and practical.",
                "Do not invent facts that are not present in the alert or logs.",
              ].join(" "),
            },
          ],
        },
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: GEMINI_TEMPERATURE,
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        },
      }),
    }, "Gemini");

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error
          ? data.error.message
          : `Gemini returned HTTP ${response.status}`,
      );
    }

    const candidate = (data.candidates || [])[0] || {};
    const finishReason = candidate.finishReason || "";
    const text = (candidate.content || {}).parts
      ? candidate.content.parts
          .map((part) => part.text || "")
          .join("")
          .trim()
      : "";

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        "[alert-ai] Gemini reached maxOutputTokens; using fallback analysis.",
      );
      return buildFallbackAnalysis(context);
    }

    const analysis = normalizeAiAnalysis(text);
    if (!analysis) {
      return buildFallbackAnalysis(context);
    }

    if (!looksLikeCompleteSentence(analysis)) {
      console.warn(
        `[alert-ai] Gemini returned incomplete analysis; using fallback. text=${trimText(analysis, 180)}`,
      );
      return buildFallbackAnalysis(context);
    }

    return trimText(analysis, AI_ANALYSIS_MAX_CHARS);
  } catch (err) {
    console.error("[alert-ai] Gemini analysis failed:", err.message);
    return "";
  }
}

function buildGeminiPrompt(context, logs) {
  const alertBlock = {
    status: context.status,
    title: context.title,
    labels: context.labels,
    annotations: context.annotations,
    values: context.values,
    valueString: context.valueString,
    startsAt: context.startsAt,
    endsAt: context.endsAt,
  };

  const logBlock =
    logs.length > 0
      ? logs
          .map(
            (item) =>
              `--- pod=${item.pod} container=${item.container} ---\n${item.text}`,
          )
          .join("\n\n")
      : "No logs were collected.";

  return [
    "Hay phan tich alert va log Kubernetes sau.",
    "",
    "Tra loi bang tieng Viet khong dau, khong Markdown dam/nghieng.",
    `Viet mot mo ta ngan khoang ${AI_ANALYSIS_WORD_LIMIT} tu ve alert/log nay.`,
    "Noi dung can gom: su co la gi, muc do anh huong, nguyen nhan kha nghi dua tren metric/log, va viec nen lam ngay.",
    "Chi tra ve mot doan van hoan chinh, khong bullet, khong cat ngang cau.",
    "Neu thieu du lieu, noi ro la chua du bang chung thay vi doan.",
    "",
    "ALERT:",
    JSON.stringify(alertBlock, null, 2),
    "",
    "RECENT LOGS:",
    logBlock,
  ].join("\n");
}

function normalizeAiAnalysis(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCompleteSentence(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }

  return /[.!?)]$/.test(value);
}

function buildFallbackAnalysis(context) {
  const severity = context.labels.severity || "unknown";
  const team = context.labels.team || "unknown";
  const summary =
    context.annotations.summary || context.annotations.description || "";
  const value = context.valueString || "";
  const target =
    context.labels.pod ||
    context.labels.deployment ||
    context.labels.app ||
    "he thong";

  const parts = [
    `Canh bao ${context.title} muc ${severity} cho team ${team} tren ${target}.`,
  ];

  if (summary) {
    parts.push(`${summary}.`);
  }

  if (value) {
    parts.push(`Gia tri hien tai: ${value}.`);
  }

  parts.push(
    "Can mo Grafana de kiem tra metric lien quan, restart count, pod readiness va log ung dung gan thoi diem alert.",
  );
  return trimText(parts.join(" "), AI_ANALYSIS_MAX_CHARS);
}

function buildTelegramMessage(context, analysis, logs) {
  const severity = context.labels.severity || "unknown";
  const team = context.labels.team || "unknown";
  const summary =
    context.annotations.summary || context.annotations.description || "";
  const sampleLog = logs.find(
    (item) => item.text && !item.text.startsWith("Could not read logs:"),
  );

  const lines = [
    `${context.status === "resolved" ? "RESOLVED" : "FIRING"} <b>${escapeHtml(context.title)}</b>`,
    `Severity: <code>${escapeHtml(severity)}</code>`,
    `Team: <code>${escapeHtml(team)}</code>`,
  ];

  if (summary) {
    lines.push(`Summary: ${escapeHtml(summary)}`);
  }

  if (context.valueString) {
    lines.push(
      `Value: <code>${escapeHtml(trimText(context.valueString, 500))}</code>`,
    );
  }

  if (analysis) {
    lines.push("");
    lines.push("<b>AI log analysis</b>");
    lines.push(escapeHtml(trimText(analysis, AI_ANALYSIS_MAX_CHARS)));
  }

  if (TELEGRAM_INCLUDE_LOG_SAMPLE && sampleLog) {
    lines.push("");
    lines.push(`<b>Log sample</b> <code>${escapeHtml(sampleLog.pod)}</code>`);
    lines.push(`<pre>${escapeHtml(trimText(sampleLog.text, 450))}</pre>`);
  }

  const link =
    context.panelURL ||
    context.dashboardURL ||
    context.generatorURL ||
    context.externalURL;
  if (link) {
    lines.push("");
    lines.push(`<a href="${escapeHtml(link)}">Open Grafana</a>`);
  }

  return trimTelegramMessage(lines.join("\n"));
}

async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!hasValue(token) || !hasValue(chatId)) {
    console.warn(
      "[alert-ai] Telegram is not configured; message was not sent.",
    );
    console.warn(stripHtml(message));
    return;
  }

  const response = await fetchWithRetry(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
    "Telegram",
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.description || `Telegram returned HTTP ${response.status}`,
    );
  }
}

async function fetchWithRetry(url, options, serviceName) {
  let lastError;

  for (let attempt = 1; attempt <= OUTBOUND_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
      });

      const retryableStatus = response.status === 429 || response.status >= 500;
      if (!retryableStatus || attempt === OUTBOUND_FETCH_ATTEMPTS) {
        return response;
      }

      await response.body?.cancel().catch(() => {});
      console.warn(
        `[alert-ai] ${serviceName} returned HTTP ${response.status}; retrying (${attempt}/${OUTBOUND_FETCH_ATTEMPTS}).`,
      );
    } catch (err) {
      lastError = err;
      if (attempt === OUTBOUND_FETCH_ATTEMPTS) {
        throw err;
      }

      console.warn(
        `[alert-ai] ${serviceName} request failed: ${err.message}; retrying (${attempt}/${OUTBOUND_FETCH_ATTEMPTS}).`,
      );
    }

    await sleep(attempt * 1500);
  }

  throw lastError || new Error(`${serviceName} request failed.`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBool(value) {
  return ["true", "1", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }

  return `${text.slice(0, maxLength - 20)}\n... [truncated]`;
}

function trimTelegramMessage(message) {
  if (message.length <= TELEGRAM_MESSAGE_MAX_CHARS) {
    return message;
  }

  return `${message.slice(0, TELEGRAM_MESSAGE_MAX_CHARS - 40)}\n... [message truncated]`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Alert AI webhook listening on 0.0.0.0:${PORT}`);
});
