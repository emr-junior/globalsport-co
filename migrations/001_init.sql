-- GlobalSport Co. schema (PostgreSQL). Money is stored as integer minor units (cents/pence).

create table roles (name text primary key);
create table permissions (name text primary key);
create table role_permissions (
  role text not null references roles(name) on delete cascade,
  permission text not null references permissions(name) on delete cascade,
  primary key (role, permission)
);
insert into roles(name) values ('customer'),('support'),('admin');
insert into permissions(name) values
 ('products.read'),('products.write'),('orders.read'),('orders.write'),('payments.confirm'),
 ('customers.read'),('customers.write'),('support.chat'),('audit.read'),('reviews.moderate');
insert into role_permissions(role, permission) values
 ('support','products.read'),('support','orders.read'),('support','support.chat'),
 ('admin','products.read'),('admin','products.write'),('admin','orders.read'),('admin','orders.write'),
 ('admin','payments.confirm'),('admin','customers.read'),('admin','customers.write'),
 ('admin','support.chat'),('admin','audit.read'),('admin','reviews.moderate');

create table users (
  id serial primary key,
  email text not null,
  name text not null,
  password_hash text,
  role text not null default 'customer' references roles(name),
  status text not null default 'active' check (status in ('active','deleted','disabled')),
  age_confirmed_13plus boolean not null default false,
  agent_online boolean not null default false,
  last_seen timestamptz,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create unique index users_email_uq on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id int references users(id) on delete cascade,
  csrf text not null,
  recent text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions(user_id);
create index sessions_exp_idx on sessions(expires_at);

create table password_resets (
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false
);

create table categories (
  id serial primary key,
  code text not null unique,
  slug text not null unique,
  name text not null,
  description text not null,
  position int not null default 0
);
create table brands (
  id serial primary key,
  name text not null unique,
  is_house boolean not null default false
);

create table products (
  id serial primary key,
  sku text not null unique,
  slug text not null unique,
  name text not null,
  category_id int not null references categories(id),
  subcategory text not null,
  brand_id int not null references brands(id),
  short_desc text not null,
  full_desc text not null,
  discount_pct int not null default 20 check (discount_pct between 0 and 90),
  image_url text not null,
  image_alt text not null,
  weight_g int,
  dimensions text,
  specs jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  is_sample boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_cat_idx on products(category_id, is_active);
create index products_brand_idx on products(brand_id);
create index products_sub_idx on products(subcategory);
create index products_created_idx on products(created_at desc, id desc);
create index products_name_idx on products(lower(name));

create table product_prices (
  product_id int not null references products(id) on delete cascade,
  currency text not null check (currency in ('USD','GBP','CAD')),
  original_cents int not null check (original_cents > 0),
  discounted_cents int not null check (discounted_cents > 0 and discounted_cents <= original_cents),
  primary key (product_id, currency)
);
create index product_prices_cur_idx on product_prices(currency, discounted_cents);

create table product_variants (
  id serial primary key,
  product_id int not null references products(id) on delete cascade,
  sku text not null unique,
  size text,
  color text,
  stock int not null default 0 check (stock >= 0),
  is_active boolean not null default true
);
create index variants_product_idx on product_variants(product_id);

create table uploads (
  id serial primary key,
  mime text not null,
  data bytea not null,
  created_by int references users(id),
  created_at timestamptz not null default now()
);
create table product_images (
  id serial primary key,
  product_id int not null references products(id) on delete cascade,
  url text not null,
  alt text not null,
  position int not null default 0
);

create table carts (
  id serial primary key,
  user_id int unique references users(id) on delete cascade,
  session_hash text unique,
  updated_at timestamptz not null default now()
);
create table cart_items (
  cart_id int not null references carts(id) on delete cascade,
  variant_id int not null references product_variants(id) on delete cascade,
  qty int not null check (qty between 1 and 20),
  primary key (cart_id, variant_id)
);
create table wishlists (
  id serial primary key,
  user_id int unique references users(id) on delete cascade,
  session_hash text unique
);
create table wishlist_items (
  wishlist_id int not null references wishlists(id) on delete cascade,
  product_id int not null references products(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (wishlist_id, product_id)
);

create table orders (
  id serial primary key,
  ref text not null unique,
  user_id int references users(id) on delete set null,
  session_hash text,
  customer_name text not null,
  email text not null,
  country text not null,
  currency text not null check (currency in ('USD','GBP','CAD')),
  subtotal_cents int not null,
  discount_cents int not null,
  shipping_cents int not null,
  tax_cents int not null default 0,
  total_cents int not null,
  status text not null default 'pending_enquiry' check (status in
    ('pending_enquiry','awaiting_payment','payment_confirmed','processing','shipped','delivered','cancelled','refunded')),
  stock_deducted boolean not null default false,
  tracking_info text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_idx on orders(user_id);
create index orders_status_idx on orders(status, created_at desc);
create table order_items (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  variant_id int references product_variants(id) on delete set null,
  product_id int references products(id) on delete set null,
  sku text not null,
  name text not null,
  size text,
  color text,
  qty int not null check (qty > 0),
  unit_original_cents int not null,
  unit_price_cents int not null
);
create index order_items_order_idx on order_items(order_id);
create table order_enquiries (
  id serial primary key,
  order_id int not null unique references orders(id) on delete cascade,
  contact_preference text not null check (contact_preference in ('email','phone','either')),
  message text not null default '',
  consent_share_at timestamptz not null default now()
);
create table order_notes (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  user_id int references users(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);
create table order_status_history (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  status text not null,
  changed_by int references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table payment_records (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  currency text not null,
  method text not null,
  reference text not null,
  confirmed_by int references users(id) on delete set null,
  confirmed_at timestamptz not null default now()
);
create table refund_records (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  currency text not null,
  reason text not null,
  recorded_by int references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table support_conversations (
  id serial primary key,
  token_hash text not null unique,
  user_id int references users(id) on delete set null,
  customer_name text not null,
  status text not null default 'open' check (status in ('open','assigned','closed')),
  agent_id int references users(id) on delete set null,
  blocked boolean not null default false,
  reported boolean not null default false,
  ip_hash text,
  agent_unread int not null default 0,
  customer_unread int not null default 0,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table support_messages (
  id serial primary key,
  conversation_id int not null references support_conversations(id) on delete cascade,
  sender text not null check (sender in ('customer','agent','system')),
  agent_id int references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index support_messages_conv_idx on support_messages(conversation_id, id);
create table offline_enquiries (
  id serial primary key,
  name text not null,
  email text not null,
  message text not null,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table reviews (
  id serial primary key,
  product_id int not null references products(id) on delete cascade,
  user_id int not null references users(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create table consent_records (
  id serial primary key,
  session_hash text,
  user_id int references users(id) on delete set null,
  purpose text not null check (purpose in ('analytics','ai','newsletter','order_share')),
  granted boolean not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);
create table newsletter_subscriptions (
  id serial primary key,
  email text not null,
  consent_at timestamptz not null default now()
);
create unique index newsletter_email_uq on newsletter_subscriptions(lower(email));
create table deletion_requests (
  id serial primary key,
  user_id int references users(id) on delete set null,
  email text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open','completed','rejected')),
  resolution_note text,
  processed_by int references users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create table ai_usage_logs (
  id serial primary key,
  session_hash text,
  status text not null,
  escalated boolean not null default false,
  input_chars int not null default 0,
  created_at timestamptz not null default now()
);
create table audit_logs (
  id serial primary key,
  actor_id int references users(id) on delete set null,
  actor_email text,
  action text not null,
  entity text,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_logs(created_at desc);
