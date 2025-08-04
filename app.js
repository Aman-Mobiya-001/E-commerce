const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const cron = require("node-cron");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");

const User = require("./models/User");
const Product = require("./models/Product");
const Order = require("./models/Order");
const Category = require("./models/Category");

// App Config
dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
   },
});

io.on("connection", (socket) => {
  socket.on("joinProductRoom", (roomId) => socket.join(roomId));
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));


// Emit stock update
function emitStockUpdate(productId, newStock) {
  io.to(`product-${productId}`).emit("stockUpdate", { stock: newStock });
}

// JWT Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden: Admins only" });
  next();
};

// Register
app.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ name, email, password: hashed });
  await user.save();
  res.json({ message: "User registered" });
});

// Login
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || "secret", {
    expiresIn: "7d",
  });
  res.json({ token });
});

/**
 * @swagger
 * /products:
 *   post:
 *     summary: Create a new product
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               price: { type: number }
 *               stock: { type: number }
 *     responses:
 *       200:
 *         description: Product created
 */

// Create product (Admin)
app.post("/products", authMiddleware, adminMiddleware, async (req, res) => {
  const { name, description, price, stock } = req.body;
  const product = new Product({ name, description, price, stock });
  await product.save();
  res.json(product);
});

/**
 * @swagger
 * /products:
 *   get:
 *     summary: Get all products
 *     responses:
 *       200:
 *         description: List of all products
 */
// Get all products
app.get("/products", async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

/**
 * @swagger
 * /products/{id}:
 *   get:
 *     summary: Get product by ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Product found
 *       404:
 *         description: Product not found
 */

// Get single product
app.get("/products/:id", async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

/**
 * @swagger
 * /products/{id}:
 *   put:
 *     summary: Update a product
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               price: { type: number }
 *               stock: { type: number }
 *     responses:
 *       200:
 *         description: Product updated
 */

// Update product (Admin)
app.put("/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  const { name, description, price, stock } = req.body;
  const updated = await Product.findByIdAndUpdate(
    req.params.id,
    { name, description, price, stock },
    { new: true }
  );
  res.json(updated);
});

/**
 * @swagger
 * /products/{id}:
 *   delete:
 *     summary: Delete a product
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Product deleted
 */

// Delete product (Admin)
app.delete("/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ message: "Product deleted" });
});

/**
 * @swagger
 * /products/{id}/stock:
 *   put:
 *     summary: Update stock of a product and emit real-time update
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stock: { type: number }
 *     responses:
 *       200:
 *         description: Stock updated
 */

// Update stock & emit real-time stock (Admin or Order)
app.put("/products/:id/stock", authMiddleware, async (req, res) => {
  const { stock } = req.body;
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { stock },
    { new: true }
  );
  if (!product) return res.status(404).json({ error: "Product not found" });

  emitStockUpdate(req.params.id, stock); // Emit real-time update
  res.json(product);
});

// Place Order
app.post("/orders", authMiddleware, async (req, res) => {
  const { products, couponCode } = req.body;

  let total = 0;
  for (let item of products) {
    const prod = await Product.findById(item.productId);
    if (!prod || prod.stock < item.quantity) {
      return res.status(400).json({ error: "Insufficient stock or invalid product" });
    }
    prod.stock -= item.quantity;
    await prod.save();
    emitStockUpdate(item.productId, prod.stock);
    total += prod.price * item.quantity;
  }

  // Apply coupon
  let couponUsed = "";
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode });
    if (coupon) {
      total = total - (total * coupon.discount) / 100;
      couponUsed = coupon.code;
    }
  }

const order = new Order({
    userId: req.user.id,
    products,
    total,
    coupon: couponUsed,
  });

  await order.save();
  res.json({ message: "Order placed", order });
});

// Get logged-in user's orders
app.get("/orders", authMiddleware, async (req, res) => {
  const orders = await Order.find({ userId: req.user.id }).populate("products.productId");
  res.json(orders);
});

// Get all orders (Admin)
app.get("/admin/orders", authMiddleware, adminMiddleware, async (req, res) => {
  const orders = await Order.find().populate("products.productId").populate("userId");
  res.json(orders);
});

// Create Coupon (Admin)
app.post("/admin/coupons", authMiddleware, adminMiddleware, async (req, res) => {
  const { code, discount } = req.body;
  const coupon = new Coupon({ code, discount });
  await coupon.save();
  res.json({ message: "Coupon created", coupon });
});

// Get all coupons
app.get("/coupons", authMiddleware, adminMiddleware, async (req, res) => {
  const coupons = await Coupon.find();
  res.json(coupons);
});

// Categories
app.post("/categories", async (req, res) => {
  try {
    const category = new Category(req.body);
    await category.save();
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/categories", async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/categories/:id", async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/categories/:id", async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: "Category deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate PDF invoice (user only for their own order)
app.get("/orders/:id/invoice", authMiddleware, async (req, res) => {
  const order = await Order.findById(req.params.id).populate("products.productId");

  if (!order || String(order.userId) !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }

  const doc = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=invoice.pdf");
  doc.pipe(res);

  doc.fontSize(20).text("E-Commerce Invoice", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Order ID: ${order._id}`);
  doc.text(`Date: ${order.createdAt.toDateString()}`);
  doc.moveDown();

  order.products.forEach((item, index) => {
    doc.text(
      `${index + 1}. ${item.productId.name} - ₹${item.productId.price} x ${item.quantity}`
    );
  });

  doc.moveDown();
  doc.text(`Coupon Used: ${order.coupon || "None"}`);
  doc.text(`Total Paid: ₹${order.total}`, { bold: true });

  doc.end();
});


// Swagger Docs
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "E-commerce API",
      version: "1.0.0",
       description: "API documentation for E-Commerce app",
    },
    servers: [
      {
        url: "http://localhost:8080",
      },
    ],
  },
  apis: ["./app.js"],
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
