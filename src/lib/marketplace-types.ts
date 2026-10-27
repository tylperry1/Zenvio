export type Supplier = {
  id: string;
  name: string;
  website: string;
  contact_email: string;
  fulfillment: "dropship" | "wholesale" | "print_on_demand";
  lead_time: string;
  notes: string;
  active: boolean;
};
export type MarketProduct = {
  is_demo?: boolean;
  id: string;
  sku: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  shipping_cents: number;
  minimum_quantity: number;
  stock: number | null;
  lead_time: string;
  has_image: boolean;
  updated_at: string;
  revision: number;
};
export type AdminProduct = MarketProduct & {
  cost_cents: number | null;
  supplier_id: string | null;
  supplier_sku: string;
  fulfillment: string;
  status: string;
};
export type OrderItem = {
  id: string;
  product_id: string;
  title: string;
  sku: string;
  quantity: number;
  price_cents: number;
  supplier_id?: string | null;
  supplier_sku?: string;
  cost_cents?: number | null;
  fulfillment?: string;
};
export type MarketOrder = {
  id: string;
  customer_name: string;
  customer_email: string;
  business_name: string;
  instructions: string;
  status: string;
  payment_status: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_cents: number;
  refund_status: string | null;
  shipping_address: {
    name?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
  } | null;
  tracking_number: string;
  tracking_url: string;
  carrier: string;
  created_at: string;
  updated_at: string;
  private_notes?: string;
  items?: OrderItem[];
  activity?: { action: string; note: string; created_at: string }[];
};
