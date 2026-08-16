# RacquetIQ analysis server — CPU pipeline (RTMPose ONNX + ffmpeg + librosa).
# Built in Azure via `az acr build` (see deploy-azure.sh); no local Docker needed.
FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

# Mirror the repo layout server.py expects: /app/analysis/.venv/bin/python
WORKDIR /app/analysis
COPY requirements.txt ./
RUN python -m venv .venv \
  && .venv/bin/pip install --no-cache-dir -U pip \
  && .venv/bin/pip install --no-cache-dir -r requirements.txt

COPY analyze.py server.py ./
COPY tools ./tools

# Pre-download the RTMPose ONNX weights so the first uploaded job does not pay
# the model-download latency. Non-fatal if the CDN hiccups — first job retries.
RUN .venv/bin/python -c "from rtmlib import Body; Body(mode='balanced', backend='onnxruntime', device='cpu')" || true

EXPOSE 8082
CMD [".venv/bin/python", "server.py"]
