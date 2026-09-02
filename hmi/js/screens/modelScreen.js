/**
 * 기종설정 화면 — 차량 기종별(FF/FR × 10) 노즐 X/Z 경로(웨이포인트) 티칭.
 * 근거: docs/05_차량기종.md, docs/02_IO_태그맵.md (2026-08-31 신규 제안)
 *
 * 사용법: FF/FR + 번호로 기종을 고른 뒤, 수동화면에서 노즐을 원하는 위치로 조그 이동시키고
 * 이 화면의 "현재 서보 위치를 점으로 추가"를 누르면 웨이포인트가 하나씩 쌓인다.
 * 경로가 완성되면 "PLC로 전달"로 점을 순서대로 PLC 레시피 메모리에 저장한다.
 *
 * PLC 통신 로직은 직접 넣지 않고 wsClient.js(window.wsClient)를 거쳐서만 서버와 통신한다.
 */

(function () {
  const container = document.getElementById("model-screen");

  container.innerHTML = `
    <h2>기종설정 (FF/FR 노즐 경로)</h2>

    <div>
      <button type="button" class="model-cat-btn" data-cat="FF">FF (전륜)</button>
      <button type="button" class="model-cat-btn" data-cat="FR">FR (후륜)</button>
    </div>
    <div id="model-number-buttons"></div>
    <p>선택된 기종: <span id="model-selected-label">-</span></p>

    <h3>웨이포인트 (X, Z mm)</h3>
    <button type="button" id="model-add-waypoint">현재 서보 위치를 점으로 추가</button>
    <table id="model-waypoint-table" border="1" cellpadding="4">
      <thead><tr><th>#</th><th>X</th><th>Z</th><th></th></tr></thead>
      <tbody></tbody>
    </table>

    <h3>PLC 전달</h3>
    <button type="button" id="model-transfer">PLC로 전달</button>
    <p id="model-transfer-progress"></p>
  `;

  const numberButtonsEl = container.querySelector("#model-number-buttons");
  const selectedLabelEl = container.querySelector("#model-selected-label");
  const waypointTbody = container.querySelector("#model-waypoint-table tbody");
  const transferProgressEl = container.querySelector("#model-transfer-progress");

  let localCategory = null; // 아직 서버에 확정 전, 카테고리 버튼만 누른 상태를 표시하기 위한 로컬 상태
  let currentSelection = null; // state.selectedVehicleModel을 그대로 따라감 — 전달 버튼에서 사용

  // 번호 버튼(1~10) 최초 1회 생성
  for (let n = 1; n <= 10; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-num-btn";
    btn.dataset.number = n;
    btn.textContent = n;
    btn.addEventListener("click", () => {
      if (!localCategory) {
        alert("먼저 FF/FR을 선택하세요");
        return;
      }
      window.wsClient.send("vehicleModel.selectModel", { category: localCategory, number: n });
    });
    numberButtonsEl.appendChild(btn);
  }

  container.querySelectorAll(".model-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      localCategory = btn.dataset.cat;
      container.querySelectorAll(".model-cat-btn").forEach((b) => b.classList.toggle("on", b === btn));
    });
  });

  container.querySelector("#model-add-waypoint").addEventListener("click", () => {
    window.wsClient.send("vehicleModel.addWaypointFromCurrentPosition");
  });

  container.querySelector("#model-transfer").addEventListener("click", () => {
    if (!currentSelection) {
      alert("먼저 기종을 선택하세요");
      return;
    }
    window.wsClient.send("vehicleModel.transferToPlc", currentSelection);
  });

  window.wsClient.onState((state) => {
    currentSelection = state.selectedVehicleModel;

    selectedLabelEl.textContent = currentSelection ? `${currentSelection.category}-${String(currentSelection.number).padStart(2, "0")}` : "-";

    container.querySelectorAll(".model-num-btn").forEach((btn) => {
      const isSelected =
        currentSelection && localCategory === currentSelection.category && Number(btn.dataset.number) === currentSelection.number;
      btn.classList.toggle("on", !!isSelected);
    });

    const detail = state.selectedVehicleModelDetail;
    waypointTbody.innerHTML = "";
    if (detail) {
      detail.waypoints.forEach((wp, index) => {
        const tr = document.createElement("tr");
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "삭제";
        delBtn.addEventListener("click", () => {
          window.wsClient.send("vehicleModel.deleteWaypoint", {
            category: currentSelection.category,
            number: currentSelection.number,
            index,
          });
        });
        tr.innerHTML = `<td>${index}</td><td>${wp.x}</td><td>${wp.z}</td>`;
        const tdBtn = document.createElement("td");
        tdBtn.appendChild(delBtn);
        tr.appendChild(tdBtn);
        waypointTbody.appendChild(tr);
      });
    }

    const progress = state.vehicleModelTransferProgress;
    transferProgressEl.textContent = progress ? `전달 중: ${progress.category}-${progress.number} (${progress.done}/${progress.total})` : "";
  });
})();
