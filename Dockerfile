# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time configuration (baked into the static bundle).
ARG VITE_API_URL=/api
ARG VITE_GITLAB_HOSTNAME=
ARG VITE_EMAIL_DOMAIN_PLACEHOLDER=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GITLAB_HOSTNAME=$VITE_GITLAB_HOSTNAME \
    VITE_EMAIL_DOMAIN_PLACEHOLDER=$VITE_EMAIL_DOMAIN_PLACEHOLDER

RUN npm run build

# Run stage
FROM node:20-alpine

RUN npm install -g serve

COPY --from=builder /app/dist /app/dist

EXPOSE 3000

CMD ["serve", "-s", "/app/dist", "-l", "3000"]
