-- Sample database for Dremio demo
CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE sales.customers (
    customer_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    city VARCHAR(80),
    country VARCHAR(80) DEFAULT 'Korea',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales.products (
    product_id SERIAL PRIMARY KEY,
    product_name VARCHAR(120) NOT NULL,
    category VARCHAR(60) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    stock_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sales.orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES sales.customers(customer_id),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    total_amount NUMERIC(12, 2) NOT NULL
);

CREATE TABLE sales.order_items (
    item_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES sales.orders(order_id),
    product_id INTEGER NOT NULL REFERENCES sales.products(product_id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL
);

INSERT INTO sales.customers (name, email, city, country) VALUES
    ('김민수', 'minsu.kim@example.com', 'Seoul', 'Korea'),
    ('이지현', 'jihyun.lee@example.com', 'Busan', 'Korea'),
    ('박서준', 'seojun.park@example.com', 'Incheon', 'Korea'),
    ('최유나', 'yuna.choi@example.com', 'Daegu', 'Korea'),
    ('정하늘', 'haneul.jung@example.com', 'Daejeon', 'Korea');

INSERT INTO sales.products (product_name, category, price, stock_qty) VALUES
    ('노트북 Pro 14', 'Electronics', 1890000.00, 42),
    ('무선 마우스', 'Electronics', 45000.00, 320),
    ('기계식 키보드', 'Electronics', 129000.00, 85),
    ('운동화 러닝', 'Fashion', 89000.00, 150),
    ('캐주얼 셔츠', 'Fashion', 39000.00, 210),
    ('스테인리스 텀블러', 'Home', 25000.00, 500),
    ('아로마 캔들', 'Home', 18000.00, 180);

INSERT INTO sales.orders (customer_id, order_date, status, total_amount) VALUES
    (1, '2025-11-02', 'completed', 1935000.00),
    (2, '2025-11-05', 'completed', 134000.00),
    (3, '2025-11-08', 'completed', 89000.00),
    (1, '2025-11-15', 'completed', 43000.00),
    (4, '2025-11-20', 'completed', 2028000.00),
    (5, '2025-12-01', 'pending', 64000.00);

INSERT INTO sales.order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 1, 1890000.00),
    (1, 2, 1, 45000.00),
    (2, 3, 1, 129000.00),
    (2, 6, 1, 25000.00),
    (3, 4, 1, 89000.00),
    (4, 5, 1, 39000.00),
    (4, 6, 1, 25000.00),
    (5, 1, 1, 1890000.00),
    (5, 3, 1, 129000.00),
    (5, 7, 1, 18000.00),
    (6, 2, 1, 45000.00),
    (6, 7, 1, 18000.00);

CREATE VIEW sales.v_order_summary AS
SELECT
    o.order_id,
    c.name AS customer_name,
    c.city,
    o.order_date,
    o.status,
    o.total_amount,
    COUNT(oi.item_id) AS item_count
FROM sales.orders o
JOIN sales.customers c ON c.customer_id = o.customer_id
LEFT JOIN sales.order_items oi ON oi.order_id = o.order_id
GROUP BY o.order_id, c.name, c.city, o.order_date, o.status, o.total_amount;
