const { default: mongoose } = require("mongoose");

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  products: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      quantity: Number,
    }
  ],
  total: Number,
  coupon: String,
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('Order', orderSchema);