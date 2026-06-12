require('dotenv').config();

const { randomUUID } = require('crypto');
const { getPool } = require('./connection');

const USERS = [
  ['admin', 'admin@cloudweb.store', 'password123', 'Admin User', 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 'admin'],
  ['alice', 'alice@cloudweb.store', 'password123', 'Alice Nguyen', 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice', 'customer'],
  ['bob', 'bob@cloudweb.store', 'password123', 'Bob Tran', 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob', 'customer'],
  ['charlie', 'charlie@cloudweb.store', 'password123', 'Charlie Le', 'https://api.dicebear.com/7.x/avataaars/svg?seed=charlie', 'customer'],
  ['diana', 'diana@cloudweb.store', 'password123', 'Diana Pham', 'https://api.dicebear.com/7.x/avataaars/svg?seed=diana', 'customer'],
];

const PRODUCTS = [
  // Electronics (4 items)
  ['Wireless Mouse', 'Compact ergonomic mouse with silent click technology and adjustable DPI up to 4000.', 29.99, 150, 'electronics', 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=900&q=80'],
  ['Mechanical Keyboard', 'Tactile keyboard with hot-swap switches, per-key RGB lighting and PBT keycaps.', 89.99, 75, 'electronics', 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80'],
  ['USB-C Hub', 'Seven-port USB-C hub with 4K HDMI, 100W power delivery, and SD card reader.', 45.50, 200, 'electronics', 'https://images.unsplash.com/photo-1625842268584-8f3296236761?auto=format&fit=crop&w=900&q=80'],
  ['Portable SSD 1TB', 'Ultra-fast NVMe portable drive with 1050MB/s read speed and military-grade durability.', 109.99, 60, 'electronics', 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?auto=format&fit=crop&w=900&q=80'],

  // Audio (4 items)
  ['Headset Pro', 'Active noise-cancelling headset with 40mm drivers and 30-hour battery life.', 119.99, 45, 'audio', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80'],
  ['Wireless Earbuds', 'True wireless earbuds with spatial audio, IPX5 waterproof, and transparency mode.', 79.99, 120, 'audio', 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?auto=format&fit=crop&w=900&q=80'],
  ['Bluetooth Speaker', 'Portable speaker with 360-degree sound, 20-hour playtime, and built-in microphone.', 49.99, 85, 'audio', 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=80'],
  ['Studio Microphone', 'USB condenser microphone with cardioid pattern, mute button, and gain control.', 69.99, 40, 'audio', 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=900&q=80'],

  // Workspace (4 items)
  ['Desk Lamp', 'Adjustable LED lamp with warm and cool modes, USB charging port, and memory function.', 34.99, 300, 'workspace', 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80'],
  ['Monitor Stand', 'Ergonomic aluminum stand with cable management and device storage underneath.', 59.99, 90, 'workspace', 'https://images.unsplash.com/photo-1527443060795-0402a18106c2?auto=format&fit=crop&w=900&q=80'],
  ['Desk Mat XL', 'Premium stitched-edge desk mat with waterproof surface, 900x400mm.', 24.99, 200, 'workspace', 'https://images.unsplash.com/photo-1616400619175-5beda3a17896?auto=format&fit=crop&w=900&q=80'],
  ['Webcam 4K', '4K webcam with auto-focus, noise-reducing dual microphones and privacy cover.', 89.99, 55, 'workspace', 'https://images.unsplash.com/photo-1587826080692-f439cd0b70da?auto=format&fit=crop&w=900&q=80'],

  // Accessories (4 items)
  ['Laptop Bag', 'Water-resistant commuter bag with padded laptop sleeve and anti-theft pocket.', 55.00, 90, 'accessories', 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=80'],
  ['Phone Stand', 'Adjustable aluminum phone/tablet stand with anti-slip silicone pads.', 19.99, 250, 'accessories', 'https://images.unsplash.com/photo-1586105449897-20b5efeb3233?auto=format&fit=crop&w=900&q=80'],
  ['Cable Organizer Kit', 'Magnetic cable clips and velcro ties set for a clean desk setup.', 14.99, 400, 'accessories', 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?auto=format&fit=crop&w=900&q=80'],
  ['Laptop Sleeve 15"', 'Slim neoprene sleeve with accessory pocket, fits up to 15.6-inch laptops.', 22.99, 180, 'accessories', 'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=900&q=80'],

  // Wearables (4 items)
  ['Smart Watch', 'Fitness smartwatch with heart rate, SpO2, GPS, and 7-day battery life.', 149.99, 35, 'wearables', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80'],
  ['Fitness Band', 'Lightweight fitness tracker with sleep analysis, step counter, and water reminder.', 39.99, 160, 'wearables', 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?auto=format&fit=crop&w=900&q=80'],
  ['Blue Light Glasses', 'Stylish anti-blue-light glasses for long screen sessions, lightweight titanium frame.', 29.99, 220, 'wearables', 'https://images.unsplash.com/photo-1574258495973-f010dfbb5371?auto=format&fit=crop&w=900&q=80'],
  ['Smart Ring', 'Titanium smart ring with sleep tracking, body temperature, and NFC payments.', 199.99, 20, 'wearables', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=80'],
];

async function seed() {
  const pool = getPool();

  // Seed users
  const userUuids = [];
  for (const [username, email, password, fullName, avatarUrl, role] of USERS) {
    const uuid = randomUUID();
    await pool.execute(
      `INSERT IGNORE INTO users (uuid, username, email, password_hash, full_name, avatar_url, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid, username, email, password, fullName, avatarUrl, role]
    );
    userUuids.push(uuid);
  }

  // Get actual user UUIDs (in case some already existed)
  const [existingUsers] = await pool.execute('SELECT uuid, username FROM users ORDER BY id');
  const userMap = {};
  for (const u of existingUsers) {
    userMap[u.username] = u.uuid;
  }

  // Seed products
  const productUuids = [];
  for (const [name, description, price, stock, category, imageUrl] of PRODUCTS) {
    const uuid = randomUUID();
    await pool.execute(
      `INSERT IGNORE INTO products
        (uuid, name, description, price, stock, category, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid, name, description, price, stock, category, imageUrl]
    );
    productUuids.push(uuid);
  }

  // Get actual product UUIDs
  const [existingProducts] = await pool.execute('SELECT uuid, name, price FROM products ORDER BY id');
  const productList = existingProducts.map((p) => ({
    uuid: p.uuid,
    price: Number(p.price),
  }));

  // Seed sample orders (only if no orders exist yet)
  const [existingOrders] = await pool.execute('SELECT COUNT(*) as cnt FROM orders');
  if (existingOrders[0].cnt === 0 && productList.length > 0) {
    const sampleOrders = [
      { user: 'alice', products: [0, 1], quantities: [1, 1], status: 'delivered' },
      { user: 'bob', products: [4, 5], quantities: [1, 2], status: 'shipped' },
      { user: 'charlie', products: [2, 8, 12], quantities: [1, 1, 1], status: 'processing' },
      { user: 'diana', products: [16, 17], quantities: [1, 1], status: 'pending' },
      { user: 'alice', products: [6, 10, 14], quantities: [2, 1, 3], status: 'delivered' },
    ];

    for (const order of sampleOrders) {
      const buyerUuid = userMap[order.user];
      if (!buyerUuid) continue;

      const orderUuid = randomUUID();
      let totalPrice = 0;
      const items = [];

      for (let i = 0; i < order.products.length; i++) {
        const pIndex = order.products[i];
        if (pIndex >= productList.length) continue;
        const product = productList[pIndex];
        const qty = order.quantities[i] || 1;
        totalPrice += product.price * qty;
        items.push({ product_uuid: product.uuid, quantity: qty, unit_price: product.price });
      }

      await pool.execute(
        'INSERT INTO orders (uuid, user_uuid, status, total_price) VALUES (?, ?, ?, ?)',
        [orderUuid, buyerUuid, order.status, totalPrice.toFixed(2)]
      );

      for (const item of items) {
        await pool.execute(
          'INSERT INTO order_items (order_uuid, product_uuid, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [orderUuid, item.product_uuid, item.quantity, item.unit_price]
        );
      }
    }

    console.log('Seeded 5 sample orders.');
  }
}

if (require.main === module) {
  seed()
    .then(async () => {
      console.log('Seed complete.');
      await getPool().end();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

module.exports = seed;
