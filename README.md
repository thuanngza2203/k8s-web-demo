# Cloud Web K8s

Full-featured e-commerce application with Kubernetes monitoring.

Architecture:

```text
Frontend Next.js (dark-mode premium UI)
    |
    v
Express API (JWT auth, CRUD, simulate endpoints)
    |
    v
MySQL

Prometheus scrapes:
- API /metrics
- Frontend /api/metrics
- kube-state-metrics
- kubelet/cAdvisor container CPU and memory metrics
- Prometheus self metrics

Grafana sends alert webhooks to Alert AI. Alert AI reads recent Kubernetes pod
logs, asks Gemini for a short incident analysis, then sends the enriched message
to Telegram.
```

## Features

- **Authentication**: JWT login/register with seeded demo accounts
- **Product catalog**: 20 products across 5 categories, search & filter
- **Shopping cart**: Add/remove items, quantity controls
- **Checkout**: Creates orders with stock deduction (requires login)
- **Order history**: View past orders with status tracking
- **Monitoring**: Prometheus metrics, 4 Grafana dashboards, alerting
- **Load testing**: 11 scenario script for Grafana demo
- **Kubernetes demos**: Service load balancing, horizontal scaling, and pod self-healing

## Demo Accounts

| Username | Password    | Role     |
| -------- | ----------- | -------- |
| admin    | password123 | admin    |
| alice    | password123 | customer |
| bob      | password123 | customer |
| charlie  | password123 | customer |
| diana    | password123 | customer |

## Local URLs

After running the scripts:

- Frontend: http://localhost:3000
- API: http://localhost:8081
- Alert AI: http://localhost:8082
- Prometheus: http://localhost:9090
- Grafana: http://localhost:4000

Grafana login: `admin` / `admin`.

## Run Locally On Docker Desktop Kubernetes

Enable Kubernetes in Docker Desktop first, then run from this folder:

```powershell
Copy-Item .env.example .env
# Fill GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID in .env.

.\scripts\local-build.ps1
.\scripts\local-up.ps1
.\scripts\local-forward.ps1
```

`local-up.ps1` resolves credentials from the current environment, then `.env`,
then an existing Kubernetes Secret. It creates `alert-ai-secret` and restarts
Alert AI when credentials are available. The `.env` file is ignored by git.

Generate demo traffic:

```powershell
curl http://localhost:8081/health
curl http://localhost:9090/api/v1/targets

.\scripts\local-load.ps1
```

Run one scenario at a time:

```powershell
.\scripts\local-load.ps1 -Scenario normal
.\scripts\local-load.ps1 -Scenario auth
.\scripts\local-load.ps1 -Scenario shopping
.\scripts\local-load.ps1 -Scenario burst
.\scripts\local-load.ps1 -Scenario error
.\scripts\local-load.ps1 -Scenario error-alert
.\scripts\local-load.ps1 -Scenario slow
.\scripts\local-load.ps1 -Scenario cpu
.\scripts\local-load.ps1 -Scenario memory
.\scripts\local-load.ps1 -Scenario db
.\scripts\local-load.ps1 -Scenario db-error
```

Demonstrate Kubernetes behavior through the internal `api` Service:

```powershell
.\scripts\k8s-demo.ps1 -Scenario balance -Requests 120
.\scripts\k8s-demo.ps1 -Scenario scale -Requests 200 -ScaleReplicas 5
.\scripts\k8s-demo.ps1 -Scenario self-heal -Requests 120
```

The load-balancing scenario opens new TCP connections from a frontend pod to
`http://api:8081`, prints request counts by API pod, and feeds the Grafana
`API Requests By Pod` panel. Direct requests through `localhost:8081` use
`kubectl port-forward` and therefore do not demonstrate Service balancing.

Clean up:

```powershell
.\scripts\local-down.ps1
```

## Load Test Scenarios

| Scenario   | What it does                                   | Grafana Dashboard                      |
| ---------- | ---------------------------------------------- | -------------------------------------- |
| `normal`   | Browse products, health checks, search, filter | Application Overview                   |
| `auth`     | Login, register, profile access                | Application Overview (business events) |
| `shopping` | Login → browse → checkout → view orders        | Application + Database Overview        |
| `burst`    | 80 concurrent product requests                 | Application Overview (spike)           |
| `error`    | 100 simulated HTTP errors                      | Application Overview + Alert Overview  |
| `slow`     | 20 parallel 3s-delay requests                  | Application Overview (latency)         |
| `cpu`      | CPU-intensive computations                     | Kubernetes Pods (CPU)                  |
| `memory`   | 80MB memory allocations                        | Kubernetes Pods (RAM)                  |
| `db`       | Heavy DB reads + order writes                  | Database Overview                      |
| `db-error` | Simulated failed DB queries                    | Database Overview + Alert Overview     |
| `all`      | All scenarios sequentially                     | All dashboards                         |

## What To Demo

1. Open the website, login as `alice`, browse products, add to cart, checkout.
2. Open Grafana dashboard `Application Overview` to show request rate, errors, latency, business events, and Node.js RAM.
3. Open `Kubernetes Pods` to show replicas, pod readiness, CPU, and RAM.
4. Open `Database Overview` to show query rate, query latency, failures, and pool connections.
5. Open `Alert Overview` after load/error simulation to show pending/firing alerts.

Useful direct API calls:

```powershell
curl http://localhost:8081/health
curl http://localhost:8081/ready
curl http://localhost:8081/metrics
curl http://localhost:8081/api/instance
curl -X POST http://localhost:8081/api/auth/login -H "Content-Type: application/json" -d '{"username":"alice","password":"password123"}'
curl http://localhost:8081/api/products
curl http://localhost:8081/api/products/categories
curl http://localhost:8081/api/simulate/error
curl http://localhost:8081/api/simulate/db-error
curl "http://localhost:8081/api/simulate/slow?delay=3000"
curl "http://localhost:8081/api/simulate/memory?size=100&hold=30"
```

Order history is scoped to the logged-in user. Calling it without a JWT should
return `401`:

```powershell
curl.exe -i http://localhost:8081/api/orders

$login = curl.exe -s -X POST http://localhost:8081/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"alice","password":"password123"}' | ConvertFrom-Json

curl.exe http://localhost:8081/api/orders `
  -H "Authorization: Bearer $($login.data.token)"
```

DB failure demo:

```powershell
.\scripts\local-load.ps1 -Scenario db-error
```

Prometheus query for the Grafana DB failure panel:

```promql
sum(rate(app_db_queries_total{success="false"}[5m])) or vector(0)
```
