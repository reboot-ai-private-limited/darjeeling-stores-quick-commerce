/**
 * Shared domain types for Darjeeling Stores Storefront,
 * aligned 1:1 with the customer mobile app API models.
 */

export type Variant = {
  variantId: string;
  sku: string;
  label: string;
  unit: string;
  price: number; // In paise
  mrp: number; // In paise
  discountPercent: number;
  available: boolean;
  stockQty: number;
  maxQty: number;
};

export type Product = {
  id: string;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  highlights?: string[];
  brand?: string | null;
  foodType?: "veg" | "non_veg" | null;
  category: { id: string; name: string };
  subCategory?: { id: string; name: string } | null;
  variants: Variant[];
  images: { id: string; url: string; sortOrder: number }[];
  badges?: string[];
  keyInfo?: { label: string; value: string }[];
  sections?: { title: string; content: string }[];
  nutrition?: { label: string; value: string }[];
  storageInstructions?: string | null;
  tags?: string[];
  availability: "in_stock" | "out_of_stock" | "closed";
};

export type Category = {
  id: string;
  name: string;
  slug?: string;
  imageUrl?: string | null;
  subcategories?: { id: string; name: string }[];
};

export type Banner = {
  id: string;
  title: string;
  imageUrl: string;
  linkType: "category" | "product" | "external";
  linkValue: string;
};

export type StoreStatus = {
  accepting: boolean;
  nextOpenAt?: string | null;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  notice?: string | null;
  paused?: boolean;
  /** Order value above which delivery is free (paise), when the zone has such a rule. */
  freeDeliveryAbove?: number | null | undefined;
  smallOrderFee?: number | undefined;
  minOrder?: number | undefined;
};

export type HomeData = {
  banners: Banner[];
  categories: Category[];
  sections: {
    id: string;
    title: string;
    subtitle?: string | null;
    products: Product[];
  }[];
  status: StoreStatus;
  notices: { kind: string; label: string }[];
};

export type BrandInfo = {
  id: string;
  name: string;
  logoUrl?: string | null;
  productCount: number;
};

export type Zone = {
  id: string;
  name: string;
  city: string;
  locality?: string;
  active: boolean;
};

export type Place = {
  label: string;
  lat: number;
  lng: number;
  localityId?: string;
};

export type Locality = {
  id: string;
  name: string;
  cityId?: string;
  location: { lat: number; lng: number };
  zoneId?: string | null;
  travelMinutes?: number;
};

export type User = {
  id: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  kind?: string;
};

export type Address = {
  id: string;
  label: "Home" | "Work" | "Other" | string;
  line1: string;
  cityId?: string;
  localityId: string;
  localityName?: string;
  pincode: string;
  landmark: string;
  contactName: string;
  contactPhone: string;
  location?: { lat: number; lng: number };
  zoneId?: string | null;
  isDeliverable?: boolean;
  isDefault: boolean;
  voiceNote?: { mediaId: string; durationSec: number } | null;
  housePhoto?: { mediaId: string } | null;
  deliveryNotes?: string | null;
  locality?: string;
  lat?: number;
  lng?: number;
};

export type AddressInput = {
  label: "Home" | "Work" | "Other" | string;
  line1: string;
  localityId: string;
  pincode: string;
  landmark: string;
  contactName: string;
  contactPhone: string;
  location: { lat: number; lng: number };
  deliveryNotes?: string | null;
  makeDefault?: boolean;
  voiceMediaId?: string | null;
  housePhotoMediaId?: string | null;
};

export type Line = {
  variantId: string;
  productId: string;
  name: string;
  label: string;
  price: number; // in paise
  mrp: number; // in paise
  imageUrl: string | null;
  qty: number;
  maxQty: number;
  available?: boolean;
};

export type ServerLine = {
  variantId: string;
  unitPrice: number;
  maxQty: number;
  available: boolean;
};

export type Correction = {
  productId: string;
  variantId: string;
  reason: string;
  qty: number;
};

export type Charge = {
  type: string;
  label: string;
  amount: number; // in paise
};

export type Pricing = {
  subtotal: number;
  discount: number;
  charges: Charge[];
  tax: number;
  total: number;
  taxInclusive: boolean;
};

export type Eta = {
  packMinutes: number;
  riderArrivalMinutes: number;
  travelMinutes: number;
  extraMinutes: number;
  promisedAt: string;
};

export type Quote = {
  id: string;
  expiresAt: string;
  zoneId: string;
  split: boolean;
  allocation: {
    warehouseId: string;
    warehouseName: string;
    lines: { productId?: string; variantId?: string; name: string; variantLabel: string; qty: number; unitPrice?: number; lineTotal: number }[];
    itemsSubtotal: number;
    eta: Eta;
  }[];
  pricing: Pricing;
  payment: {
    codAllowed: boolean;
    codMaxAmount?: number;
    onlineAllowed: boolean;
  };
  /** The coupon the server priced the order with, if any. */
  couponCode?: string | null;
};

export type CouponRow = {
  code: string;
  description: string;
  minOrder: number;
  discountPaise: number;
  applicable: boolean;
  inapplicableReason?: string | null;
  expiresAt?: string | null;
};

export type OrderItem = {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  status?: string;
  imageUrl?: string | null;
};

export type ChildOrder = {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus?: string;
  refundStatus?: string;
  items?: OrderItem[];
  itemsSubtotal?: number;
  promisedAt?: string | null;
  amountDue?: number;
  rider?: { name: string; phone: string } | null;
  timeline?: { status: string; at: string }[];
};

export type OrderGroup = {
  id: string;
  groupNo: string;
  status: string;
  paymentMethod: "cod" | "online";
  paymentStatus: string;
  pricing: Pricing;
  address: {
    line1: string;
    landmark: string;
    locality: string;
    pincode: string;
    contactName: string;
  };
  deliveryOtp?: string;
  children: ChildOrder[];
  createdAt: string;
};

export type OrderSummary = {
  groupId: string;
  groupNo: string;
  status: string;
  total: number;
  createdAt: string;
  children: {
    id: string;
    orderNo: string;
    status: string;
    itemCount: number;
    promisedAt?: string | null;
  }[];
};

export type CheckoutData = {
  razorpayKeyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  expiresAt: string;
};

export type PreorderSlot = {
  id: string;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
  remainingCapacity: number;
};
