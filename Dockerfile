FROM node:24-alpine AS frontend
WORKDIR /build
COPY package.json ./
COPY scripts ./scripts
COPY web ./web
RUN npm run check && npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /build
COPY go.mod *.go ./
COPY --from=frontend /build/dist ./web
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /modulelab .

FROM alpine:3.23
RUN mkdir /data && chown 10001:10001 /data
COPY --from=backend /modulelab /usr/local/bin/modulelab
USER 10001:10001
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/modulelab"]
