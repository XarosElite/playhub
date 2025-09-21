# ============================= base =============================
FROM node:22 as base

WORKDIR /frontend

COPY package.json package.json

RUN npm install

# ========================= development =========================
from base as development
COPY . .

EXPOSE 4201

CMD ["npm", "run", "dev"]


# ========================= production build =========================
from base as prodbuild
COPY . .
RUN npm run build

# ========================= production =========================
from nginx:alpine as production

COPY --from=prodbuild /frontend/dist /usr/share/nginx/html

EXPOSE 80
# Change to build for prod
CMD ["nginx", "-g", "daemon off;"]

