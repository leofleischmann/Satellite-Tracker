FROM python:3.9-slim

WORKDIR /app

# Install curl for webhook requests (IPv6 support)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ensure data directory exists
RUN mkdir -p data

# Expose port
EXPOSE 5000

CMD ["python", "app.py"]
