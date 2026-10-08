FROM python:3.12-slim

# THE CONTAINER RUNS ON MINE TIME.
#
# Every figure this service reports is a wall-clock figure written in Odisha --
# SAP's malfunction timestamps, the shift log's production date, a stock entry's
# entry date -- and both databases store them naive at +05:30. A container
# defaulting to UTC put the application five and a half hours behind its own
# data: open breakdowns were cut short, date.today() returned yesterday until
# 05:30, and the 07:00 digest ran at 12:30.
#
# Set here rather than only in compose so the image is correct however it is
# started, and overridable by the environment for anyone running it elsewhere.
# tzdata is required: without it glibc cannot resolve a named zone and silently
# falls back to UTC.
ENV TZ=Asia/Kolkata
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./app ./app

EXPOSE 8989

# gunicorn manages worker processes — crashed workers are auto-respawned.
# UvicornWorker gives async ASGI support. 2 workers handles concurrent requests.
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "2", \
     "--bind", "0.0.0.0:8989", \
     "--timeout", "120", \
     "--keep-alive", "5", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
