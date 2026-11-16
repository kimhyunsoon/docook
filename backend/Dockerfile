# 빌드 컨텍스트는 backend/ (deploy/docker-compose.yml 의 build: ../backend)
# 실행 이미지는 node:22-slim 과 같은 Debian 12(glibc) 기반 - 서버 구커널(CentOS 7)에서 동작 확인된 조합
# 데이터 폴더가 root 소유라 distroless 의 root 변형(:nonroot 아님)을 쓴다
FROM rust:1.99.1-slim-bookworm AS chef
RUN cargo install cargo-chef --version 0.1.78 --locked
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# 의존성 층은 Cargo.lock 이 바뀔 때만 다시 빌드된다
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked --bins

FROM gcr.io/distroless/cc-debian12
ENV NODE_ENV=production
WORKDIR /app
# schema.sql·ingredient-pool.sql 은 바이너리에 포함(include_str!)
COPY --from=builder /app/target/release/docook-backend /app/docook-backend
EXPOSE 4346
ENTRYPOINT ["/app/docook-backend"]
