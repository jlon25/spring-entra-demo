FROM node:24.22.2-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx/nginx-unprivileged:1.30.6-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/auditions/browser /usr/share/nginx/html
USER 101
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
