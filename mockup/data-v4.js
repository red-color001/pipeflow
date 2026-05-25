/* Pipeline diagram data v4 — vertical USERS column + vertical KAFKA column.
   Loaded as plain JS — exposes window.PIPELINE.                              */
(function () {
  // ─── Color tokens (legend) ──────────────────────────────────────────
  const C = {
    indigo:   "#818cf8",
    teal:     "#2dd4bf",
    amber:    "#fbbf24",
    red:      "#f87171",
    violet:   "#c084fc",
    orange:   "#fb923c",
    green:    "#34d399",
    cyan:     "#22d3ee",
    pink:     "#f472b6",
    purple:   "#a78bfa",
    yorange:  "#facc15",
    neutral:  "#64748b",
  };

  // ─── Nodes ──────────────────────────────────────────────────────────
  // [id, label, kind, x, y, w, h, color]
  const N = [
    // ── COLUMN A: Users / External (VERTICAL, left edge) ────────────
    ["U_ADM",    "Admin",         "user",  35,  80, 170, 48, C.orange],
    ["U_AF",     "Airflow User",  "user",  35, 140, 170, 48, C.amber],
    ["U_KAF",    "Kafka UI User", "user",  35, 200, 170, 48, C.yorange],
    ["U_DUCK",   "DuckDB User",   "user",  35, 260, 170, 48, C.green],
    ["U_PROM",   "Prom User",     "user",  35, 320, 170, 48, C.cyan],
    ["U_GRAF",   "Grafana User",  "user",  35, 380, 170, 48, C.cyan],
    ["U_PORT",   "Portainer",     "user",  35, 440, 170, 48, C.cyan],
    ["U_FE",     "App User",      "user",  35, 500, 170, 48, C.indigo],
    ["U_LENSA",  "Lensa User",    "user",  35, 560, 170, 48, C.pink],

    // ── External source (standalone, NOT a user) ────────────────────
    ["YTAPI",    "YouTube API",   "ext",   35, 660, 170, 64, C.orange],

    // ── Frontend lane (y=100) ───────────────────────────────────────
    ["ADFE",     "Admin · FE",        "fe",  260, 100, 170, 60, C.orange],
    ["DUCKFE",   "DuckDB · FE",       "fe",  460, 100, 170, 60, C.green],
    ["KFDPROXY", "Kafdrop · Proxy",   "fe",  660, 100, 170, 60, C.yorange],
    ["FE",       "App · Frontend",    "fe",  870, 100, 200, 60, C.indigo],
    ["LFE",      "Lensa · FE",        "fe", 1110, 100, 180, 60, C.pink],

    // ── Backend lane (y=200) ────────────────────────────────────────
    ["ADBE",     "Admin · BE",        "be",  260, 200, 170, 60, C.orange],
    ["DUCKBE",   "DuckDB · BE",       "be",  460, 200, 170, 60, C.green],
    ["KFD",      "Kafdrop",           "be",  660, 200, 170, 60, C.yorange],
    ["BE",       "App · Backend",     "be",  870, 200, 200, 60, C.teal],
    ["LBE",      "Lensa · BE",        "be", 1110, 200, 180, 60, C.pink],
    ["LETL",     "Lensa · ETL",       "be", 1110, 300, 180, 60, C.pink],

    // ── Orchestration row (y=380) ───────────────────────────────────
    ["AF",       "Airflow",           "svc", 260, 380, 200, 60, C.amber],
    ["REDIS",    "Redis",             "svc", 480, 380, 140, 60, C.amber],

    // ── KEDA Workers (y=480) ────────────────────────────────────────
    ["MLAPI",    "ML · API",          "wk",  260, 480, 170, 60, C.violet],
    ["ETL",      "ETL · Worker",      "wk",  440, 480, 170, 60, C.violet],
    ["LAND",     "Landing",           "wk",  620, 480, 160, 60, C.violet],
    ["KEDA",     "KEDA Controller",   "svc", 800, 480, 200, 60, C.violet],

    // ── Model Learning (y=380, right) ───────────────────────────────
    ["EC",       "Entity-Clustering", "svc", 870, 380, 200, 60, C.purple],
    ["OLLAMA",   "Ollama",            "svc",1090, 380, 130, 60, C.purple],

    // ── KAFKA (Strimzi) — VERTICAL column (x=1320) ──────────────────
    ["STRIMZI",  "Strimzi · Operator","kf", 1320, 100, 220, 50, C.red],
    ["KF0",      "Kafka · Broker 0",  "kf", 1320, 165, 220, 50, C.red],
    ["KF1",      "Kafka · Broker 1",  "kf", 1320, 230, 220, 50, C.red],
    ["KF2",      "Kafka · Broker 2",  "kf", 1320, 295, 220, 50, C.red],
    ["ENT_OP",   "Entity · Operator", "kf", 1320, 360, 220, 50, C.red],
    ["KAFKA_NP", "Kafka · NetPolicy", "kf", 1320, 425, 220, 50, C.red],

    // ── Data stores (right of Kafka) ────────────────────────────────
    ["PG",       "Postgres",          "db", 1590, 130, 180, 90, C.teal],
    ["DUCK",     "DuckDB",            "db", 1590, 260, 180, 90, C.green],

    // ── Observability (bottom row, y=600) ───────────────────────────
    ["PTAIL",    "Promtail",          "obs", 260, 600, 140, 50, C.cyan],
    ["LOKI",     "Loki",              "obs", 410, 600, 110, 50, C.cyan],
    ["PROM",     "Prometheus",        "obs", 530, 600, 150, 50, C.cyan],
    ["GRAF",     "Grafana",           "obs", 690, 600, 130, 50, C.cyan],
    ["PORT",     "Portainer",         "obs", 830, 600, 130, 50, C.cyan],
    ["ALERT",    "Alertmgr",          "obs", 970, 600, 130, 50, C.cyan],
    ["KPROM",    "kube-prom",         "obs",1110, 600, 130, 50, C.cyan],
    ["KGRAF",    "kube-graf",         "obs",1250, 600, 130, 50, C.cyan],
    ["NODE_EXP", "node-exp",          "obs",1390, 600, 130, 50, C.cyan],
  ];

  // ─── Cluster backgrounds (visual grouping) ──────────────────────────
  // [id, label, x, y, w, h, color, orient?]   orient: "V" = vertical title
  const CLUSTERS = [
    ["cl_user",  "Users",                  20,  60, 200, 560, C.neutral, "V"],
    ["cl_ext",   "External",               20, 640, 200,  98, C.orange,  "V"],
    ["cl_admin", "Admin Console",         250,  80, 190, 200, C.orange],
    ["cl_duck",  "DuckDB UI",             450,  80, 190, 200, C.green],
    ["cl_kafd",  "Kafka UI",              650,  80, 190, 200, C.yorange],
    ["cl_app",   "App API",               860,  80, 220, 200, C.teal],
    ["cl_lensa", "Lensa Stack",          1100,  80, 200, 290, C.pink],
    ["cl_orch",  "Orchestration",         250, 360, 380, 100, C.amber],
    ["cl_wk",    "KEDA Workers",          250, 460, 760, 100, C.violet],
    ["cl_ml",    "Model Learning",        860, 360, 370, 100, C.purple],
    ["cl_kafka", "Kafka (Strimzi)",      1310,  80, 240, 410, C.red, "V"],
    ["cl_data",  "Data Stores",          1580, 100, 200, 280, C.teal],
    ["cl_obs",   "Observability",         250, 580, 1280, 90, C.cyan],
  ];

  // ─── Edges (semantic; visual positions derived from nodes) ──────────
  const E = [
    // 🟣 UI → User (PULL — user requests, dashed to indicate pull semantics)
    ["FE","U_FE","indigo",{dashed:true}],
    ["ADFE","U_ADM","orange",{dashed:true}],
    ["LFE","U_LENSA","pink",{dashed:true}],
    ["DUCKFE","U_DUCK","green",{dashed:true}],
    ["KFDPROXY","U_KAF","yorange",{dashed:true}],
    ["PROM","U_PROM","cyan",{dashed:true}],
    ["GRAF","U_GRAF","cyan",{dashed:true}],
    ["PORT","U_PORT","cyan",{dashed:true}],
    ["AF","U_AF","amber",{dashed:true}],

    // 🟢 App API teal
    ["FE","BE","teal"],
    ["BE","PG","teal"],
    ["BE","DUCK","teal"],

    // 🟠 Admin
    ["ADFE","ADBE","orange"],
    ["ADBE","PG","orange"],
    ["ADBE","LAND","orange"],

    // 🟡 YouTube ingestion
    ["YTAPI","AF","orange", {bottleneck:"AF"}],
    ["AF","DUCK","amber"],

    // 🟢 DuckDB UI
    ["DUCKFE","DUCKBE","green"],
    ["DUCKBE","DUCK","green"],

    // 🟧 Kafka UI
    ["KFDPROXY","KFD","yorange"],
    ["KFD","KF0","yorange"],
    ["KFD","KF1","yorange"],

    // 🌸 Lensa
    ["LFE","LBE","pink"],
    ["LBE","LETL","pink"],
    ["LETL","LAND","pink"],

    // 🟡 Airflow
    ["AF","ETL","amber"],
    ["AF","LAND","amber"],
    ["AF","MLAPI","amber"],
    ["AF","REDIS","amber"],
    ["AF","KAFKA_NP","amber",{label:"orchestrate"}],
    ["AF","PG","amber"],

    // 🔴 Kafka NetPolicy → Brokers
    ["KAFKA_NP","KF0","red"],
    ["KAFKA_NP","KF1","red"],
    ["KAFKA_NP","KF2","red"],

    // 🔴 Workers publish to Kafka
    ["ETL","KF0","red"],
    ["LAND","KF1","red"],
    ["MLAPI","KF2","red"],

    // 🟢 Landing → DuckDB
    ["LAND","DUCK","green"],

    // 🔴 Operators
    ["STRIMZI","KF0","red"],
    ["STRIMZI","KF1","red"],
    ["STRIMZI","KF2","red"],
    ["ENT_OP","KF1","red"],
    ["ENT_OP","KF2","red"],
    ["KAFKA_NP","ENT_OP","red"],

    // 🔴 Kafka sub
    ["KF1","BE","red"],
    ["KF2","EC","red"],
    ["KF0","DUCK","red"],

    // 🟪 KEDA scale signals
    ["KEDA","ETL","violet",{dashed:true}],
    ["KEDA","LAND","violet",{dashed:true}],
    ["KEDA","MLAPI","violet",{dashed:true}],
    ["KF0","KEDA","violet",{dashed:true, label:"lag"}],

    // 🟣 ML loop
    ["EC","OLLAMA","purple"],
    ["OLLAMA","DUCK","purple"],
    ["DUCK","EC","purple"],

    // 🔵 Observability
    ["PTAIL","LOKI","cyan"],
    ["LOKI","GRAF","cyan"],
    ["PROM","GRAF","cyan"],
    ["KPROM","PROM","cyan"],
    ["KGRAF","GRAF","cyan"],
    ["NODE_EXP","KPROM","cyan"],
    ["ALERT","KPROM","cyan"],

    // Prom scrape (dashed)
    ["PROM","BE","cyan",{dashed:true}],
    ["PROM","AF","cyan",{dashed:true}],
    ["PROM","KF1","cyan",{dashed:true}],
    ["PROM","KEDA","cyan",{dashed:true}],
  ];

  // Index nodes
  const NODE = {};
  N.forEach(([id,label,kind,x,y,w,h,color]) => {
    NODE[id] = { id, label, kind, x, y, w, h, color, cx: x + w/2, cy: y + h/2 };
  });

  window.PIPELINE = { C, NODES: N.map(n => NODE[n[0]]), NODE, CLUSTERS, EDGES: E };
})();
