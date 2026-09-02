/**
 * PLC 연결 환경설정 (IP, 포트, 폴링주기 등).
 * 실제 값은 PLC 발주·납품 후 확정. 시뮬레이터 개발 단계에서는 simulator 주소를 가리킨다.
 */

module.exports = {
  plc: {
    host: "127.0.0.1", // TODO: 실제 PLC IP로 교체 (납품 후)
    port: 502, // Modbus TCP 기본 포트
    pollingIntervalMs: null, // TODO: 확정 필요 — 너무 짧으면 PLC 부하, 너무 길면 응답 지연
  },
  simulator: {
    host: "127.0.0.1",
    port: 5020, // 개발 중 simulator/src/mockPlcServer.js 가 사용할 포트 (임시)
  },
};
