/**
 * 공정 시퀀스(0~9단계) 상태 미러링.
 * 근거: docs/03_공정시퀀스.md
 *
 * 이 모듈은 PLC가 이미 진행시킨 sequenceStep 레지스터 값을 읽어
 * HMI에 WebSocket으로 push하는 역할만 한다. 다음 단계로 "진행시키는" 판단은 하지 않는다.
 *
 * 개발 순서 (PROJECT_PLAN.md Phase 3):
 *   1. simulator 로 sequenceStep 값을 0~9로 순환/지정 테스트 → server/test/phase3_stateMachine.manual.js
 *   2. 값 변화를 감지해 api/wsServer.js 를 통해 hmi 로 push (Phase 4에서 연결)
 *
 * 폴링 주기: plcConfig.js 의 pollingIntervalMs 가 아직 미확정(null, PLC 부하 vs 응답지연
 * 트레이드오프 때문에 확정 대기 중)이라, 값이 없으면 아래 DEFAULT_POLLING_INTERVAL_MS를
 * 개발 단계 기본값으로 쓴다. 실제 값이 확정되면 plcConfig.js 에 채우기만 하면 그쪽이 우선된다.
 */

const DEFAULT_POLLING_INTERVAL_MS = 300;

// modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)와
// registerMap.js 를 받아 sequenceStep을 주기적으로 읽는 상태머신을 만든다.
// onChange(step) 콜백은 값이 "바뀔 때만" 호출된다 (매 폴링마다 부르지 않음 — 불필요한 push 방지).
function createStateMachine(modbusClient, registerMap, plcConfig) {
  const intervalMs = plcConfig.plc.pollingIntervalMs || DEFAULT_POLLING_INTERVAL_MS;

  let currentStep = null;
  let pollTimer = null;
  let onChangeCallback = null;

  async function poll() {
    try {
      const [step] = await modbusClient.readHoldingRegisters(registerMap.holdingRegisters.sequenceStep.addr, 1);
      if (step !== currentStep) {
        currentStep = step;
        if (onChangeCallback) onChangeCallback(step);
      }
    } catch (err) {
      // 연결이 끊긴 동안의 읽기 실패는 client.js 의 재접속 로직이 알아서 복구하므로
      // 여기서는 로그만 남기고 상태머신 자체를 멈추지 않는다.
      console.error("[stateMachine] sequenceStep 읽기 실패:", err.message);
    }
  }

  return {
    // 폴링 시작. onChange는 sequenceStep이 바뀔 때마다 (newStep) => {} 형태로 호출된다.
    start(onChange) {
      onChangeCallback = onChange;
      if (pollTimer) return;
      pollTimer = setInterval(poll, intervalMs);
      poll(); // 시작하자마자 한 번 즉시 읽어서 초기값을 바로 반영
    },

    stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    // 마지막으로 읽은 단계 (아직 한 번도 못 읽었으면 null)
    getCurrentStep() {
      return currentStep;
    },
  };
}

module.exports = { createStateMachine, DEFAULT_POLLING_INTERVAL_MS };
