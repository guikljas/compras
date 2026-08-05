-- CompraControl / Erimax: estrutura PostgreSQL
-- Execute este arquivo em um banco PostgreSQL vazio.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), legal_name VARCHAR(150) NOT NULL, trade_name VARCHAR(150), cnpj VARCHAR(18) UNIQUE, email VARCHAR(150), phone VARCHAR(30), active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE sectors (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL, code VARCHAR(30) UNIQUE, cost_center VARCHAR(50), manager_name VARCHAR(120), active BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE categories (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL UNIQUE, description TEXT, active BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE suppliers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), legal_name VARCHAR(150) NOT NULL, trade_name VARCHAR(150), cnpj VARCHAR(18) UNIQUE, contact_name VARCHAR(120), email VARCHAR(150), phone VARCHAR(30), address TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(150) NOT NULL, description TEXT, category_id UUID REFERENCES categories(id), unit VARCHAR(30) NOT NULL, brand VARCHAR(100), active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE purchases (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), supplier_id UUID NOT NULL REFERENCES suppliers(id), sector_id UUID NOT NULL REFERENCES sectors(id), purchase_date DATE NOT NULL, document_number VARCHAR(80), payment_method VARCHAR(50), notes TEXT, total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(total_amount >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE purchase_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE, product_id UUID NOT NULL REFERENCES products(id), quantity NUMERIC(14,3) NOT NULL CHECK(quantity > 0), unit_price NUMERIC(14,2) NOT NULL CHECK(unit_price >= 0), total_amount NUMERIC(14,2) GENERATED ALWAYS AS (ROUND((quantity * unit_price)::numeric,2)) STORED);
CREATE INDEX idx_purchases_date ON purchases(purchase_date); CREATE INDEX idx_purchases_sector ON purchases(sector_id); CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);

-- Visão para o comparador de preços.
CREATE VIEW supplier_product_prices AS SELECT pi.product_id,p.supplier_id,MIN(pi.unit_price) AS lowest_price,MAX(pi.unit_price) AS highest_price,AVG(pi.unit_price) AS average_price,MAX(p.purchase_date) AS last_purchase_date FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id GROUP BY pi.product_id,p.supplier_id;

-- Dados mínimos de demonstração.
INSERT INTO companies (legal_name,trade_name,cnpj) VALUES ('Erimax Produtos para Saúde Ltda.','Erimax','00.000.000/0001-00');
INSERT INTO sectors (name,code,cost_center) VALUES ('Produção','PROD','1001'),('Qualidade','QUAL','1002'),('Administrativo','ADM','1003'),('Logística','LOG','1004'),('TI','TI','1005');
INSERT INTO categories (name) VALUES ('Material hospitalar'),('Embalagens'),('EPI'),('Manutenção');
INSERT INTO suppliers (legal_name,cnpj,contact_name,email,phone) VALUES ('Alfa Distribuidora Ltda.','12.345.678/0001-90','Mariana Costa','comercial@alfadistribuidora.com','(11) 3456-7890'),('Beta Comercial Ltda.','45.678.901/0001-12','Carlos Lima','vendas@betacomercial.com','(11) 98765-4321'),('Central Suprimentos Ltda.','89.012.345/0001-67','Ana Souza','atendimento@central.com','(11) 3333-1050');
INSERT INTO products (code,name,category_id,unit,brand) SELECT 'ERI-001','Compressa de Gaze Estéril',id,'Pacote','Erimax' FROM categories WHERE name='Material hospitalar';
