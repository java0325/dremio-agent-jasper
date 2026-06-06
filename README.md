# Dremio Sample Database Setup

로컬 Dremio에 연동된 PostgreSQL 샘플 DB입니다.

## 구성

| 항목 | 값 |
|------|-----|
| DB 종류 | PostgreSQL 16 (Docker) |
| 컨테이너명 | `sample-postgres` |
| 포트 | `5432` |
| 데이터베이스 | `sample_sales` |
| 사용자 / 비밀번호 | `dremio_user` / `dremio_pass` |
| Dremio 소스명 | `SampleSalesDB` |

## 샘플 데이터 (sales 스키마)

- `customers` — 고객 5명
- `products` — 상품 7개
- `orders` — 주문 6건
- `order_items` — 주문 상세 12건
- `v_order_summary` — 주문 요약 뷰

## 실행 / 중지

```bash
# 시작
docker compose up -d

# 중지
docker compose down

# 데이터까지 삭제
docker compose down -v
```

## Dremio에서 쿼리 예시

```sql
SELECT * FROM "SampleSalesDB".sales.customers;

SELECT
  c.name,
  o.order_date,
  o.total_amount
FROM "SampleSalesDB".sales.orders o
JOIN "SampleSalesDB".sales.customers c
  ON c.customer_id = o.customer_id
ORDER BY o.order_date;
```

## 왜 PostgreSQL?

Dremio는 PostgreSQL 네이티브 커넥터를 지원하며, Docker로 빠르게 띄울 수 있고 스키마/뷰/조인 테스트에 적합합니다.
