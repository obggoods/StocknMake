// FILE: src/pages/Dashboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { AppData } from "../data/models";
import { loadData as loadLocalData } from "../data/store";
import { getOrCreateMyProfile } from "../lib/supabaseClient";
import { ensureStoreProductStatesSeedDB, loadDataFromDB, upsertInventoryItemDB } from "../data/store.supabase";

type DashView = "inventory" | "todo";

const LOW_STOCK_THRESHOLD_DEFAULT = 2;
const RESTOCK_TO_DEFAULT = 5;

// 제작 리스트의 "합계" 탭을 위한 특수 ID
const ALL_TAB_ID = "__ALL__";

const FILE_PREFIX = "StocknMake";

const DASH = {
  inventory: "inventory",
  todo: "todo",
} as const;

function safeFilename(name: string) {
  return name.replace(/[\\\/:*?"<>|]/g, "_").trim();
}

// -----------------------------
// 📥 CSV 다운로드 유틸
// -----------------------------
function downloadCSV(filename: string, rows: string[][]) {
  const csvContent = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const BOM = "\uFEFF"; // ✅ 엑셀 한글 깨짐 방지
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  // ✅ 데이터(초기엔 로컬 표시)
  const [data, setData] = useState<AppData>(() => loadLocalData());

  // ✅ 유저별 기본 목표 재고 수량 (profiles.default_target_qty)
  const [restockTo, setRestockTo] = useState<number>(RESTOCK_TO_DEFAULT);

  const [lowStockThreshold, setLowStockThreshold] = useState<number>(LOW_STOCK_THRESHOLD_DEFAULT);

  // ✅ DB 로드 상태
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showDisabledProducts, setShowDisabledProducts] = useState(false);

  // ✅ 화면 상태
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  const [dashView, setDashView] = useState<DashView>(DASH.inventory);

  // ✅ refresh 중복 호출 방지(동시에 여러 refresh가 돌지 않게)
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);

  // inventory index: storeId::productId -> onHandQty
  const invIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of data.inventory) {
      m.set(`${it.storeId}::${it.productId}`, it.onHandQty);
    }
    return m;
  }, [data.inventory]);

  const getOnHandQty = useCallback(
    (storeId: string, productId: string) => {
      return invIndex.get(`${storeId}::${productId}`) ?? 0;
    },
    [invIndex]
  );

  // ✅ 재고 저장 디바운스 타이머
  const invSaveTimers = useRef<Record<string, number>>({});

  // ✅ 재고 저장 예약(디바운스)
  const scheduleInventorySave = useCallback((storeId: string, productId: string, qty: number) => {
    const key = `${storeId}__${productId}`;

    // 기존 예약 취소
    const prev = invSaveTimers.current[key];
    if (prev) window.clearTimeout(prev);

    // 500ms 뒤에 DB 저장 1번만 실행
    invSaveTimers.current[key] = window.setTimeout(async () => {
      try {
        await upsertInventoryItemDB({
          storeId,
          productId,
          onHandQty: qty,
        });
      } catch (e) {
        console.error(e);
        toast.error("재고 저장 실패 (로그인 / 권한 / RLS 확인)");
      }
    }, 500);
  }, []);

  // ✅ 입점처별 제품 활성화 여부
  const isEnabledInStore = useCallback(
    (storeId: string, productId: string) => {
      const hit = data.storeProductStates.find((x) => x.storeId === storeId && x.productId === productId);
      return hit ? hit.enabled : true; // 기본값 true
    },
    [data.storeProductStates]
  );

  // -----------------------------
  // 1) DB에서 최신 데이터 로드 함수 (최적화 버전)
  // - 기본: 1회 로드
  // - store_product_states 누락 조합이 있을 때만 seed
  // - seed 했을 때만 2차 로드
  // - 동시에 여러 refresh가 돌면 1개로 합치고, 필요 시 1번 더 실행
  // -----------------------------
  const refreshFromDB = useCallback(async () => {
    // 이미 refresh가 돌고 있으면 "한 번 더"만 예약하고 끝
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return refreshInFlightRef.current;
    }

    const run = (async () => {
      do {
        refreshQueuedRef.current = false;

        // 1) 한 번만 로드
        console.time("[PERF] loadDataFromDB #1");
        const dbData = await loadDataFromDB();
        console.timeEnd("[PERF] loadDataFromDB #1");

        const storeIds = dbData.stores.map((s) => s.id);
        const productIds = dbData.products.map((p) => p.id);

        // 2) store×product 조합 누락 여부 검사
        // (누락이 있을 때만 seed)
        let needSeed = false;
        if (storeIds.length > 0 && productIds.length > 0) {
          const exist = new Set<string>();
          for (const x of dbData.storeProductStates ?? []) {
            exist.add(`${x.storeId}::${x.productId}`);
          }

          // 하나라도 없으면 seed 필요
          outer: for (const sId of storeIds) {
            for (const pId of productIds) {
              if (!exist.has(`${sId}::${pId}`)) {
                needSeed = true;
                break outer;
              }
            }
          }
        }

        if (needSeed) {
          console.time("[PERF] ensureStoreProductStatesSeedDB");
          await ensureStoreProductStatesSeedDB({ storeIds, productIds });
          console.timeEnd("[PERF] ensureStoreProductStatesSeedDB");

          // seed를 했으면 그 결과를 반영하기 위해 1회만 재로드
          console.time("[PERF] loadDataFromDB #2");
          const dbData2 = await loadDataFromDB();
          console.timeEnd("[PERF] loadDataFromDB #2");

          setData(dbData2);

          if (dbData2.stores.length > 0) {
            setSelectedStoreId((prev) => prev || dbData2.stores[0].id);
          }
        } else {
          // seed 불필요면 그대로 반영 (2차 로드 없음)
          setData(dbData);

          if (dbData.stores.length > 0) {
            setSelectedStoreId((prev) => prev || dbData.stores[0].id);
          }
        }

        // refresh 도중 누군가 또 refresh를 요청했으면 1번 더 돌기
      } while (refreshQueuedRef.current);
    })();

    refreshInFlightRef.current = run;

    try {
      await run;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, []);

  // -----------------------------
  // 2) 최초 진입 시: DB에서 로드
  // -----------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      console.log("[DB] start");
      try {
        setLoading(true);
        setErrorMsg(null);

        await refreshFromDB();

        if (!alive) return;
        console.log("[DB] refreshFromDB done");
      } catch (e: any) {
        console.error("[DB] error", e);
        if (!alive) return;
        setErrorMsg(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshFromDB]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const profile = await getOrCreateMyProfile();
        if (!alive) return;
        setRestockTo(profile.default_target_qty ?? RESTOCK_TO_DEFAULT);
        setLowStockThreshold(profile.low_stock_threshold ?? LOW_STOCK_THRESHOLD_DEFAULT);
      } catch (e) {
        console.error("[profiles] failed to load profile in dashboard", e);
        if (!alive) return;
        setRestockTo(RESTOCK_TO_DEFAULT);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // -----------------------------
  // 📥 재고 현황 CSV
  // -----------------------------
  const exportInventoryCSV = useCallback(() => {
    console.log("[CSV] exportInventoryCSV start", new Date().toISOString());
    const today = new Date().toISOString().slice(0, 10);

    // -----------------------------
    // 1) 전체 재고 현황 CSV
    // -----------------------------
    const allRows: string[][] = [];
    allRows.push(["입점처", "제품", "현재 재고"]);

    // 정렬: 입점처 → 제품
    const allItems: Array<{ storeName: string; productLabel: string; qty: number }> = [];

    data.inventory.forEach((inv) => {
      const store = data.stores.find((s) => s.id === inv.storeId);
      const product = data.products.find((p) => p.id === inv.productId);
      if (!store || !product) return;

      allItems.push({
        storeName: store.name,
        productLabel: `${product.category ?? "-"} - ${product.name}`,
        qty: inv.onHandQty,
      });
    });

    allItems.sort((a, b) => {
      const s = a.storeName.localeCompare(b.storeName, "ko");
      if (s !== 0) return s;
      return a.productLabel.localeCompare(b.productLabel, "ko");
    });

    for (const it of allItems) {
      allRows.push([it.storeName, it.productLabel, String(it.qty)]);
    }

    downloadCSV(`${FILE_PREFIX}_재고현황_전체_${today}.csv`, allRows);

    // -----------------------------
    // 2) 입점처별 CSV 여러 개
    // -----------------------------
    for (const store of data.stores) {
      const storeRows: string[][] = [];
      storeRows.push(["제품", "현재 재고"]);

      const items: Array<{ productLabel: string; qty: number }> = [];

      data.inventory
        .filter((inv) => inv.storeId === store.id)
        .forEach((inv) => {
          const product = data.products.find((p) => p.id === inv.productId);
          if (!product) return;

          items.push({
            productLabel: `${product.category ?? "-"} - ${product.name}`,
            qty: inv.onHandQty,
          });
        });

      // 제품 정렬
      items.sort((a, b) => a.productLabel.localeCompare(b.productLabel, "ko"));

      for (const it of items) {
        storeRows.push([it.productLabel, String(it.qty)]);
      }

      const storeSafe = safeFilename(store.name);
      downloadCSV(`${FILE_PREFIX}_재고현황_${storeSafe}_${today}.csv`, storeRows);
    }
  }, [data]);

  // -----------------------------
  // 4) derived 값들
  // -----------------------------
  const stores = useMemo(() => sortByCreatedAtDesc(data.stores), [data.stores]);

  const products = useMemo(() => {
    return [...data.products]
      .filter((p) => p.active)
      .sort((a, b) => {
        const c = (a.category ?? "").localeCompare(b.category ?? "");
        if (c !== 0) return c;
        return a.name.localeCompare(b.name);
      });
  }, [data.products]);

  const visibleProductsForSelectedStore = useMemo(() => {
    if (!selectedStoreId) return products;
    if (selectedStoreId === ALL_TAB_ID) return products;
    return products.filter((p) => isEnabledInStore(selectedStoreId, p.id));
  }, [products, selectedStoreId, isEnabledInStore]);

  // ✅ 재고 현황 탭에서: 선택 입점처 기준으로 (ON 제품 먼저, OFF 제품은 접기/펼치기)
  const { disabledProducts, productsForInventory } = useMemo(() => {
    if (!selectedStoreId || selectedStoreId === ALL_TAB_ID) {
      // 전체/미선택 상태에서도: 단종은 맨 아래로
      const normal = products.filter((p) => p.makeEnabled !== false);
      const discontinued = products.filter((p) => p.makeEnabled === false);
      return {
        disabledProducts: [] as typeof products,
        productsForInventory: [...normal, ...discontinued],
      };
    }

    const enabled: typeof products = [];
    const disabled: typeof products = [];

    for (const p of products) {
      (isEnabledInStore(selectedStoreId, p.id) ? enabled : disabled).push(p);
    }

    // ✅ ON 목록에서만 단종을 아래로
    const enabledNormal = enabled.filter((p) => p.makeEnabled !== false);
    const enabledDiscontinued = enabled.filter((p) => p.makeEnabled === false);

    const disabledNormal = disabled.filter((p) => p.makeEnabled !== false);
    const disabledDiscontinued = disabled.filter((p) => p.makeEnabled === false);

    return {
      disabledProducts: disabled,
      productsForInventory: showDisabledProducts
        ? [...enabledNormal, ...enabledDiscontinued, ...disabledNormal, ...disabledDiscontinued]
        : [...enabledNormal, ...enabledDiscontinued],
    };
  }, [products, selectedStoreId, isEnabledInStore, showDisabledProducts]);

  useEffect(() => {
    setShowDisabledProducts(false);
  }, [selectedStoreId]);

  // 선택 입점처 총 재고
  const totalOnHand = useMemo(() => {
    if (!selectedStoreId || selectedStoreId === ALL_TAB_ID) return 0;
    let sum = 0;
    for (const it of data.inventory) {
      if (it.storeId === selectedStoreId) sum += it.onHandQty;
    }
    return sum;
  }, [data.inventory, selectedStoreId]);

  // 선택 입점처 제작 리스트
  const storeTodoRows = useMemo(() => {
    if (!selectedStoreId || selectedStoreId === ALL_TAB_ID) return [];

    return visibleProductsForSelectedStore
      .filter((p) => p.makeEnabled !== false) // 제작 제외
      .map((p) => {
        const onHand = getOnHandQty(selectedStoreId, p.id);
        const need = onHand <= lowStockThreshold ? Math.max(0, restockTo - onHand) : 0;
        return { product: p, onHand, need };
      })
      .filter((row) => row.need > 0);
  }, [selectedStoreId, visibleProductsForSelectedStore, getOnHandQty, lowStockThreshold, restockTo]);

  // 전체 제작 리스트(합계)
  const allTodoRows = useMemo(() => {
    const out: Array<{ product: (typeof products)[number]; totalNeed: number }> = [];

    for (const p of products) {
      if (p.makeEnabled === false) continue; // 제작 제외(단종/제작중지)

      let sumNeed = 0;

      for (const s of stores) {
        if (!isEnabledInStore(s.id, p.id)) continue;
        const onHand = getOnHandQty(s.id, p.id);
        if (onHand <= lowStockThreshold) {
          sumNeed += Math.max(0, restockTo - onHand);
        }
      }

      if (sumNeed > 0) out.push({ product: p, totalNeed: sumNeed });
    }

    return out;
  }, [products, stores, isEnabledInStore, getOnHandQty, lowStockThreshold, restockTo]);

  /// -----------------------------
  // 📥 제작 리스트 CSV (전체=제품별 총합 + 입점처별 파일)
  // -----------------------------
  const exportProductionCSV = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);

    // 1) 전체 제작 리스트 (제품별 총합)
    {
      const rows: string[][] = [];
      rows.push(["품목", "제품", "총 필요 수량"]);

      const sortedAllTodo = [...allTodoRows].sort((a, b) => {
        const ac = (a.product.category ?? "").localeCompare(b.product.category ?? "", "ko");
        if (ac !== 0) return ac;
        return a.product.name.localeCompare(b.product.name, "ko");
      });

      for (const row of sortedAllTodo) {
        rows.push([row.product.category ?? "-", row.product.name, String(row.totalNeed)]);
      }

      downloadCSV(`${FILE_PREFIX}_제작리스트_전체_${today}.csv`, rows);
    }

    // 2) 입점처별 제작 리스트 (각 파일)
    for (const store of data.stores) {
      const items: Array<{
        productLabel: string;
        onHand: number;
        need: number;
      }> = [];

      // 이 입점처의 제품들 중 제작 필요만 모으기
      for (const p of products) {
        // 입점처 취급 OFF 제외 + 제작 제외 제외
        if (!isEnabledInStore(store.id, p.id)) continue;
        if (p.makeEnabled === false) continue;

        const onHand = getOnHandQty(store.id, p.id);
        const need = onHand <= lowStockThreshold ? Math.max(0, restockTo - onHand) : 0;
        if (need <= 0) continue;

        items.push({
          productLabel: `${p.category ?? "-"} - ${p.name}`,
          onHand,
          need,
        });
      }

      if (items.length === 0) continue;

      items.sort((a, b) => a.productLabel.localeCompare(b.productLabel, "ko"));

      const storeRows: string[][] = [];
      storeRows.push(["제품", "현재 재고", "목표 재고", "필요 수량"]);

      for (const it of items) {
        storeRows.push([it.productLabel, String(it.onHand), String(restockTo), String(it.need)]);
      }

      const storeSafe = safeFilename(store.name);
      downloadCSV(`${FILE_PREFIX}_제작리스트_${storeSafe}_${today}.csv`, storeRows);
    }
  }, [data.stores, products, allTodoRows, getOnHandQty, isEnabledInStore, lowStockThreshold, restockTo]);

  // -----------------------------
  // 5) 화면 렌더
  // -----------------------------
  if (errorMsg) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>스톡앤메이크</div>
        <h2 style={{ marginTop: 0 }}>DB 로드 실패</h2>
        <div style={{ padding: 12, background: "#f3f4f6", borderRadius: 8 }}>{errorMsg}</div>
        <button
          style={{ marginTop: 12 }}
          onClick={() => {
            setErrorMsg(null);
            setLoading(true);
            refreshFromDB()
              .catch((e) => setErrorMsg(e?.message ?? String(e)))
              .finally(() => setLoading(false));
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  // ✅ 대시보드 페이지
  return (
    <div className="pageWrap">
      <div className="pageContainer">
        <h2 className="pageTitle">대시보드</h2>

        {loading && (
          <div style={{ fontSize: 12, color: "#666", margin: "6px 0 10px" }}>
            동기화 중…
          </div>
        )}

        <div className="summaryRow">
          <Card title="입점처" value={`${stores.length}`} />
          <Card title="활성 제품" value={`${products.length}`} />
          <Card title="선택 입점처 총 재고" value={`${totalOnHand}`} />
        </div>

        <div className="viewSwitch">
          <button
            type="button"
            className={`viewBtn ${dashView === DASH.inventory ? "viewBtnActive" : ""}`}
            onClick={() => setDashView(DASH.inventory)}
            disabled={loading}
            style={{
              opacity: loading ? 0.5 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            title={loading ? "동기화 중…" : undefined}
          >
            재고 현황
          </button>

          <button
            type="button"
            className={`viewBtn ${dashView === DASH.todo ? "viewBtnActive" : ""}`}
            onClick={() => setDashView(DASH.todo)}
            disabled={loading}
            style={{
              opacity: loading ? 0.5 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            title={loading ? "동기화 중…" : undefined}
          >
            제작 리스트
          </button>
        </div>

        {/* 📥 데이터 다운로드 ← 여기 */}
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#666" }}>데이터 다운로드</span>

            <button onClick={exportInventoryCSV} className="viewBtn" disabled={loading}>
              재고 현황
            </button>

            <button onClick={exportProductionCSV} className="viewBtn" disabled={loading}>
              제작 리스트
            </button>
          </div>
        </div>

        {/* 1) 재고 현황 */}
        {dashView === DASH.inventory && (
          <section className="panel">
            <h3 className="sectionTitle">입점처별 재고 현황</h3>
            <p className="sectionDesc">엑셀 시트처럼 입점처 탭을 눌러 재고를 확인/수정할 수 있어.</p>

            {stores.length === 0 ? (
              <p className="emptyState">입점처가 없어. 마스터에서 입점처를 추가해줘.</p>
            ) : products.length === 0 ? (
              <p className="emptyState">활성 제품이 없어. 마스터에서 제품을 추가/활성해줘.</p>
            ) : (
              <>
                <StoreTabs
                  stores={stores}
                  selectedStoreId={selectedStoreId}
                  onSelect={setSelectedStoreId}
                  showAllTab={false}
                />

                {!selectedStoreId || selectedStoreId === ALL_TAB_ID ? (
                  <p className="emptyState" style={{ marginTop: 12 }}>
                    위 탭에서 입점처를 선택해줘.
                  </p>
                ) : (
                  <>
                    {disabledProducts.length > 0 && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                        <button type="button" className="viewBtn" onClick={() => setShowDisabledProducts((v) => !v)}>
                          {showDisabledProducts ? "OFF 제품 접기" : `OFF 제품 ${disabledProducts.length}개 펼치기`}
                        </button>
                      </div>
                    )}

                    <div className="tableWrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: 140 }}>품목</th>
                            <th>제품</th>
                            <th className="numCol">현재 재고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productsForInventory.map((p) => {
                            const enabled = isEnabledInStore(selectedStoreId, p.id);
                            const onHand = getOnHandQty(selectedStoreId, p.id);

                            return (
                              <tr
                                key={p.id}
                                className={[
                                  !enabled ? "rowDisabled" : "",
                                  enabled && p.makeEnabled === false ? "rowDiscontinued" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              >
                                {/* 1열: 품목(카테고리) */}
                                <td>{p.category ?? "-"}</td>

                                {/* 2열: 제품명 */}
                                <td>{p.name}</td>

                                {/* 3열: 현재 재고 입력 */}
                                <td className="numCol">
                                  <input
                                    className="qtyInput"
                                    type="number"
                                    inputMode="numeric"
                                    disabled={loading}
                                    value={onHand === 0 ? "" : onHand}
                                    placeholder="0"
                                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                                    onKeyDown={(e) => {
                                      const k = e.key;
                                    
                                      const isEnter = k === "Enter";
                                      const isDown = k === "ArrowDown";
                                      const isUp = k === "ArrowUp";
                                    
                                      if (!isEnter && !isDown && !isUp) return;
                                    
                                      // Enter/방향키 기본 동작(폼 submit, 커서 이동 등) 막기
                                      e.preventDefault();
                                    
                                      const current = e.currentTarget;
                                    
                                      // 현재 input이 속한 tableWrap(재고 테이블) 안에서만 이동
                                      const scope =
                                        (current.closest(".tableWrap") as HTMLElement | null) ?? document.body;
                                    
                                      const inputs = Array.from(
                                        scope.querySelectorAll<HTMLInputElement>("input.qtyInput:not([disabled])")
                                      );
                                    
                                      const idx = inputs.indexOf(current);
                                      if (idx < 0) return;
                                    
                                      // 이동 방향 결정:
                                      // - Enter: Shift 누르면 위, 아니면 아래
                                      // - ArrowUp: 위
                                      // - ArrowDown: 아래
                                      const dir =
                                        isEnter ? (e.shiftKey ? -1 : 1) : isUp ? -1 : 1;
                                    
                                      const next = inputs[idx + dir];
                                    
                                      if (next) {
                                        next.focus();
                                        next.select?.(); // 바로 덮어쓰기 편하게
                                      } else {
                                        // 맨 끝(또는 맨 처음)에서 더 가려 하면 그냥 blur
                                        current.blur();
                                      }
                                    }}                                    
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const nextQty = raw === "" ? 0 : Number(raw);

                                      setData((prev) => {
                                        const storeId = selectedStoreId;
                                        const productId = p.id;

                                        const idx = prev.inventory.findIndex(
                                          (it) => it.storeId === storeId && it.productId === productId
                                        );

                                        if (idx === -1) {
                                          return {
                                            ...prev,
                                            inventory: [
                                              ...prev.inventory,
                                              { storeId, productId, onHandQty: nextQty, updatedAt: Date.now() },
                                            ],
                                          };
                                        }

                                        const nextInv = [...prev.inventory];
                                        nextInv[idx] = { ...nextInv[idx], onHandQty: nextQty, updatedAt: Date.now() };
                                        return { ...prev, inventory: nextInv };
                                      });

                                      scheduleInventorySave(selectedStoreId, p.id, nextQty);
                                    }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* 2) 제작 리스트 */}
        {dashView === DASH.todo && (
          <section className="panel">
            <h3 className="sectionTitle">제작 리스트</h3>
            <p className="sectionDesc">
              <b>합계</b> 탭은 전체 입점처 부족분 합산, 입점처 탭은 해당 입점처 기준으로 보여줘. (재고 2개 이하만,
              목표 5개까지 채우기)
            </p>

            {stores.length === 0 ? (
              <p className="emptyState">입점처가 없어. 마스터에서 입점처를 추가해줘.</p>
            ) : (
              <>
                <StoreTabs stores={stores} selectedStoreId={selectedStoreId} onSelect={setSelectedStoreId} showAllTab={true} />

                {selectedStoreId === ALL_TAB_ID ? (
                  allTodoRows.length === 0 ? (
                    <p className="emptyState" style={{ marginTop: 12 }}>
                      전체 기준 제작 필요 없음
                    </p>
                  ) : (
                    <div className="tableWrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: 140 }}>품목</th>
                            <th>제품</th>
                            <th className="numCol">총 만들기</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allTodoRows.map((row) => (
                            <tr key={row.product.id}>
                              <td>{row.product.category ?? "-"}</td>
                              <td>{row.product.name}</td>
                              <td className="numCol" style={{ fontWeight: 800 }}>
                                {row.totalNeed}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : !selectedStoreId ? (
                  <p className="emptyState" style={{ marginTop: 12 }}>
                    위 탭에서 입점처를 선택해줘.
                  </p>
                ) : storeTodoRows.length === 0 ? (
                  <p className="emptyState" style={{ marginTop: 12 }}>
                    제작 필요 없음 (재고 2개 이하 제품이 없어)
                  </p>
                ) : (
                  <div className="tableWrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 140 }}>품목</th>
                          <th>제품</th>
                          <th className="numCol">현재 재고</th>
                          <th className="numCol">만들기</th>
                        </tr>
                      </thead>
                      <tbody>
                        {storeTodoRows.map((row) => (
                          <tr key={row.product.id}>
                            <td>{row.product.category ?? "-"}</td>
                            <td>{row.product.name}</td>
                            <td className="numCol">{row.onHand}</td>
                            <td className="numCol" style={{ fontWeight: 800 }}>
                              {row.need}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// -----------------------------
// UI 컴포넌트들
// -----------------------------
function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="summaryCard">
      <div className="summaryCardTitle">{title}</div>
      <div className="summaryCardValue">{value}</div>
    </div>
  );
}

function StoreTabs({
  stores,
  selectedStoreId,
  onSelect,
  showAllTab,
}: {
  stores: Array<{ id: string; name: string }>;
  selectedStoreId: string;
  onSelect: (id: string) => void;
  showAllTab: boolean;
}) {
  return (
    <div className="sheetTabsWrap">
      <div className="sheetTabs">
        {showAllTab && (
          <button
            type="button"
            onClick={() => onSelect(ALL_TAB_ID)}
            className={`sheetTab ${selectedStoreId === ALL_TAB_ID ? "sheetTabActive" : ""}`}
          >
            합계
          </button>
        )}

        {stores.map((s) => {
          const active = selectedStoreId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`sheetTab ${active ? "sheetTabActive" : ""}`}
              type="button"
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------
// helpers
// -----------------------------
function sortByCreatedAtDesc<T extends { createdAt: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => b.createdAt - a.createdAt);
}
