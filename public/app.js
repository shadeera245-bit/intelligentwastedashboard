const ws = new WebSocket(`ws://${window.location.host}`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  document.getElementById("capacity").textContent =
    data.capacity + "%";

  document.getElementById("wasteType").textContent =
    data.wasteType;

  document.getElementById("status").textContent =
    data.status;
};