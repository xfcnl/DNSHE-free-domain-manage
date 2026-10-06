#!/usr/bin/env bash
#
# 批量删除 DNSHE 所有域名的 NS 记录
#
# 用法：
#   DNSHE_API_KEY=xxx DNSHE_API_SECRET=yyy ./scripts/dnshe-delete-ns.sh          # dry-run（只看不删）
#   DNSHE_API_KEY=xxx DNSHE_API_SECRET=yyy CONFIRM=yes ./scripts/dnshe-delete-ns.sh   # 真正删除
#
# 可选环境变量：
#   DNSHE_API_BASE  覆盖 API 地址
#   SLEEP           每次删除之间的间隔秒数（默认 2.2，避开限流）
#   ONLY            只处理某个完整域名，如 ONLY=xf0.cc.cd
#
set -euo pipefail

API_KEY="${DNSHE_API_KEY:?请设置环境变量 DNSHE_API_KEY}"
API_SECRET="${DNSHE_API_SECRET:?请设置环境变量 DNSHE_API_SECRET}"
BASE="${DNSHE_API_BASE:-https://api005.dnshe.com/index.php?m=domain_hub}"
SLEEP="${SLEEP:-2.2}"
ONLY="${ONLY:-}"
DRY_RUN=1
if [ "${CONFIRM:-}" = "yes" ]; then DRY_RUN=0; fi

api_get() {
  curl -s "${BASE}&endpoint=$1&action=$2${3:-}" \
    -H "X-API-Key: ${API_KEY}" -H "X-API-Secret: ${API_SECRET}"
}

api_post() {
  curl -s -X POST "${BASE}&endpoint=$1&action=$2" \
    -H "X-API-Key: ${API_KEY}" -H "X-API-Secret: ${API_SECRET}" \
    -H "Content-Type: application/json" -d "$3"
}

# 从 stdin 读取 JSON，取点分路径的值
jget() {
  node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try{const j=JSON.parse(d);
        const v=process.argv[1].split(".").reduce((o,k)=>o==null?o:o[k],j);
        console.log(v==null?"":(typeof v==="object"?JSON.stringify(v):v));
      }catch(e){console.log("")}
    });' "$1"
}

if [ "$DRY_RUN" = "1" ]; then
  echo "==> DRY-RUN 模式（不会真正删除）。要真删请加 CONFIRM=yes"
else
  echo "==> 删除模式：将真实删除 NS 记录！"
fi
[ -n "$ONLY" ] && echo "==> 仅处理：$ONLY"

echo "==> 拉取子域名列表"
SUBJSON="$(api_get subdomains list "&per_page=500")"
if [ "$(printf '%s' "$SUBJSON" | jget success)" != "true" ]; then
  echo "拉取失败：$(printf '%s' "$SUBJSON" | jget error)"
  exit 1
fi

SUBS="$(printf '%s' "$SUBJSON" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    const j=JSON.parse(d);
    for(const s of (j.subdomains||[])) console.log(s.id+"\t"+s.full_domain);
  });')"

TOTAL=0
while IFS=$'\t' read -r sid fqdn; do
  [ -z "${sid:-}" ] && continue
  if [ -n "$ONLY" ] && [ "$fqdn" != "$ONLY" ]; then continue; fi

  DNSJSON="$(api_get dns_records list "&subdomain_id=${sid}")"
  NSIDS="$(printf '%s' "$DNSJSON" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const j=JSON.parse(d);
      for(const r of (j.records||[])) if(r.type==="NS") console.log((r.record_id||r.id));
    });')"

  n=$(printf '%s\n' "$NSIDS" | grep -c . || true)
  if [ "${n:-0}" -eq 0 ]; then
    echo "  ${fqdn}: 无 NS 记录"
    continue
  fi
  echo "  ${fqdn}: 发现 ${n} 条 NS"

  while IFS= read -r rid; do
    [ -z "${rid:-}" ] && continue
    if [ "$DRY_RUN" = "1" ]; then
      echo "    [dry-run] 将删除 record_id=${rid}"
      continue
    fi
    RES="$(api_post dns_records delete "{\"record_id\":\"${rid}\"}")"
    if [ "$(printf '%s' "$RES" | jget success)" = "true" ]; then
      echo "    已删除 record_id=${rid}"
      TOTAL=$((TOTAL+1))
    else
      echo "    删除失败 record_id=${rid}: $(printf '%s' "$RES" | jget error)"
    fi
    sleep "$SLEEP"
  done <<< "$NSIDS"
done <<< "$SUBS"

if [ "$DRY_RUN" = "1" ]; then
  echo "==> DRY-RUN 结束"
else
  echo "==> 完成，共删除 ${TOTAL} 条 NS 记录"
fi
