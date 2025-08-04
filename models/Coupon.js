const { default: mongoose } = require("mongoose");

const couponSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  discount: Number,
});
module.exports = mongoose.model('Coupon', couponSchema);
