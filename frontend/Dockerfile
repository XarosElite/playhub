# ============================= base =============================
FROM node:20-alpine as base

WORKDIR /frontend

COPY package.json yarn.lock ./

RUN yarn install

# ============================= test =============================
# Unit and component tests (Vitest), type checks and lint.
from base as test
COPY . .
CMD ["sh", "-c", "yarn lint && yarn tsc -b && yarn test"]

# ========================= e2e =========================
# Browser tests (Playwright) against a fake API. Its own image: the browsers
# need glibc, and the version must match @playwright/test in package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-noble as e2e
WORKDIR /frontend
RUN npm install -g yarn@1.22.22
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
ENV CI=1
CMD ["yarn", "test:e2e"]

# ========================= development =========================
from base as development
COPY . .

EXPOSE 4201

CMD ["npm", "run", "dev"]


# ========================= production build =========================
from base as prodbuild
# Vite inlines VITE_* variables at build time (passed from .env by docker-compose).
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
COPY . .
RUN npm run build

# ========================= production =========================
from nginx:alpine as production

COPY --from=prodbuild /frontend/dist /usr/share/nginx/html

EXPOSE 80
# Change to build for prod
CMD ["nginx", "-g", "daemon off;"]

