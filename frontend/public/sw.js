// 최소 서비스워커 — 홈화면 설치 가능 조건 충족용 (오프라인 캐싱 없음)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
