# ============================= base =============================
FROM python:3.13 as base

WORKDIR /app

COPY requirements.txt .

RUN pip install --prefix=/install -r requirements.txt

# ============================= test =============================
from base as test

WORKDIR /app
COPY --from=base /install /usr/local
RUN pip install pytest
COPY . .

ENTRYPOINT ["pytest"]

# ========================= development =========================
from base as development

WORKDIR /app
COPY --from=base /install /usr/local
COPY . .

ENTRYPOINT ["fastapi", "dev", "main.py", "--host", "0.0.0.0"]

# ========================= production =========================
from python:3.13-slim as production

WORKDIR /app
COPY --from=base /install /usr/local
COPY . .

ENTRYPOINT ["fastapi", "run", "main.py", "--host", "0.0.0.0"]
