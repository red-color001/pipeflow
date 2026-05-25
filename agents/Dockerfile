FROM python:3.12-slim

WORKDIR /app

COPY packages/sdk-py/pyproject.toml ./packages/sdk-py/
COPY packages/sdk-py/pipeflow_agent ./packages/sdk-py/pipeflow_agent
RUN pip install --no-cache-dir ./packages/sdk-py

COPY agents/runner.py ./runner.py

CMD ["python", "-u", "runner.py"]
