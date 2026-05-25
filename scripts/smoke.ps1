# Smoke test: register a few agents over HTTP, then read /topology.
# Run AFTER: docker compose up -d postgres ; npm run migrate ; npm run dev:server

$ErrorActionPreference = 'Stop'
$API   = $env:PIPEFLOW_BACKEND
if (-not $API) { $API = 'http://localhost:4000' }
$TOKEN = $env:PIPEFLOW_TOKEN
if (-not $TOKEN) { $TOKEN = 'dev-token-change-me' }

$headers = @{ Authorization = "Bearer $TOKEN"; 'Content-Type' = 'application/json' }

function Register($body) {
  Invoke-RestMethod -Method Post -Uri "$API/agents/register" -Headers $headers -Body ($body | ConvertTo-Json -Depth 5) | Out-Null
}

Register @{ id='youtube-api'; label='YouTube API'; node_type='ext'; color='orange';
           targets = @(@{ to='airflow'; color='orange' }) }
Register @{ id='airflow'; label='Airflow'; node_type='svc'; color='amber';
           targets = @(
             @{ to='postgres'; color='amber' },
             @{ to='kafka-broker-0'; color='amber'; label='orchestrate' },
             @{ to='etl-worker'; color='amber' }
           ) }
Register @{ id='postgres'; label='Postgres'; node_type='db'; color='teal' }
Register @{ id='kafka-broker-0'; label='Kafka · Broker 0'; node_type='kf'; color='red';
           targets = @(@{ to='duckdb'; color='red' }) }
Register @{ id='duckdb';    label='DuckDB'; node_type='db'; color='green' }
Register @{ id='etl-worker'; label='ETL · Worker'; node_type='wk'; color='violet';
           targets = @(@{ to='kafka-broker-0'; color='red' }) }

$topo = Invoke-RestMethod -Method Get -Uri "$API/topology"
Write-Host ("nodes:    {0}" -f $topo.nodes.Count)
Write-Host ("edges:    {0}" -f $topo.edges.Count)
Write-Host ("clusters: {0}" -f $topo.clusters.Count)
Write-Host ""
Write-Host "Open http://localhost:5173 to see the diagram."
