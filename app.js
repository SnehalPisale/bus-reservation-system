// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  idToken: null,
  email: null,
  selectedTrip: null,
  selectedSeats: new Set(),
};

// ---------------------------------------------------------------------
// Cognito auth — plain fetch calls to the public Cognito Identity
// Provider JSON API. No SDK/CDN dependency needed: SignUp,
// ConfirmSignUp, and InitiateAuth (USER_PASSWORD_AUTH) are public
// operations for an app client with no secret.
// ---------------------------------------------------------------------
async function cognitoRequest(target, body) {
  const res = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.__type || "Cognito request failed");
  }
  return data;
}

async function handleSignUp() {
  const email = document.getElementById("su-email").value.trim();
  const password = document.getElementById("su-password").value;
  try {
    await cognitoRequest("SignUp", {
      ClientId: CONFIG.userPoolClientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
    showAuthMessage("Account created — check your email for a verification code.", false);
  } catch (err) {
    showAuthMessage(err.message, true);
  }
}

async function handleConfirmSignUp() {
  const email = document.getElementById("su-email").value.trim();
  const code = document.getElementById("su-code").value.trim();
  try {
    await cognitoRequest("ConfirmSignUp", {
      ClientId: CONFIG.userPoolClientId,
      Username: email,
      ConfirmationCode: code,
    });
    showAuthMessage("Email confirmed — you can sign in now.", false);
  } catch (err) {
    showAuthMessage(err.message, true);
  }
}

async function handleSignIn() {
  const email = document.getElementById("si-email").value.trim();
  const password = document.getElementById("si-password").value;
  try {
    const result = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CONFIG.userPoolClientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    state.idToken = result.AuthenticationResult.IdToken;
    state.email = email;
    document.getElementById("auth-status").textContent = `Signed in as ${email}`;
    showAuthMessage("Signed in.", false);
    loadMyBookings();
  } catch (err) {
    showAuthMessage(err.message, true);
  }
}

function handleSignOut() {
  state.idToken = null;
  state.email = null;
  document.getElementById("auth-status").textContent = "Not signed in";
  document.getElementById("my-bookings").innerHTML = "";
}

function showAuthMessage(text, isError) {
  const el = document.getElementById("auth-message");
  el.textContent = text;
  el.className = "message " + (isError ? "error" : "success");
}

// ---------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------
async function apiRequest(path, method = "GET", body = null, needsAuth = false) {
  const headers = {};

  if (body !== null) {
    headers["Content-Type"] = "application/json";
  }

  if (needsAuth) {
    if (!state.idToken) {
      throw new Error("Please sign in first.");
    }

    headers["Authorization"] = state.idToken;
  }

  const res = await fetch(`${CONFIG.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

// ---------------------------------------------------------------------
// Search + seat selection + booking
// ---------------------------------------------------------------------
async function handleSearch() {
  const origin = document.getElementById("origin").value.trim();
  const destination = document.getElementById("destination").value.trim();
  const date = document.getElementById("travel-date").value;
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "Searching...";

  try {
    const params = new URLSearchParams({ origin, destination, date });
    const data = await apiRequest(`/routes?${params.toString()}`);
    if (data.trips.length === 0) {
      resultsEl.innerHTML = "<p>No trips found for that route/date.</p>";
      return;
    }
    resultsEl.innerHTML = "";
    data.trips.forEach((trip) => {
      const div = document.createElement("div");
      div.className = "trip-card";
      div.innerHTML = `
        <div>
          <strong>${trip.bus_name}</strong><br/>
          ${trip.departure_time} → ${trip.arrival_time}<br/>
          ₹${trip.fare} · ${trip.available_seats}/${trip.total_seats} seats left
        </div>
        <button>Select</button>
      `;
      div.querySelector("button").onclick = () => selectTrip(trip);
      resultsEl.appendChild(div);
    });
  } catch (err) {
    resultsEl.innerHTML = `<p class="message error">${err.message}</p>`;
  }
}

async function selectTrip(trip) {
  state.selectedTrip = trip;
  state.selectedSeats = new Set();
  document.getElementById("seat-section").style.display = "block";
  const seatMapEl = document.getElementById("seat-map");
  seatMapEl.innerHTML = "Loading seats...";

  const data = await apiRequest(`/trips/${trip.trip_id}/seats`);
  seatMapEl.innerHTML = "";
  data.seats.forEach((seat) => {
    const btn = document.createElement("div");
    const isAvailable = seat.seat_status === "AVAILABLE";
    btn.className = `seat ${isAvailable ? "available" : "booked"}`;
    btn.textContent = seat.seat_number;
    if (isAvailable) {
      btn.onclick = () => toggleSeat(seat.seat_number, btn);
    }
    seatMapEl.appendChild(btn);
  });
}

function toggleSeat(seatNumber, el) {
  if (state.selectedSeats.has(seatNumber)) {
    state.selectedSeats.delete(seatNumber);
    el.classList.remove("selected");
  } else {
    state.selectedSeats.add(seatNumber);
    el.classList.add("selected");
  }
}

async function handleBook() {
  const msgEl = document.getElementById("booking-message");
  if (!state.selectedTrip || state.selectedSeats.size === 0) {
    msgEl.textContent = "Select at least one seat first.";
    msgEl.className = "message error";
    return;
  }
  const passengerName = document.getElementById("passenger-name").value.trim();
  const contact = document.getElementById("contact").value.trim();

  try {
    const result = await apiRequest(
      "/bookings",
      "POST",
      {
        trip_id: state.selectedTrip.trip_id,
        seat_numbers: Array.from(state.selectedSeats),
        passenger_name: passengerName,
        contact,
      },
      true
    );
    msgEl.textContent = `Booked! Confirmation: ${result.booking_id}`;
    msgEl.className = "message success";
    selectTrip(state.selectedTrip); // refresh seat map
    loadMyBookings();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = "message error";
  }
}

// ---------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------
async function loadMyBookings() {
  const el = document.getElementById("my-bookings");
  if (!state.idToken) {
    el.innerHTML = "<p>Sign in to see your bookings.</p>";
    return;
  }
  el.innerHTML = "Loading...";
  try {
    const data = await apiRequest("/bookings", "GET", null, true);
    if (data.bookings.length === 0) {
      el.innerHTML = "<p>No bookings yet.</p>";
      return;
    }
    el.innerHTML = "";
    data.bookings.forEach((b) => {
      const div = document.createElement("div");
      div.className = "booking-item";
      div.innerHTML = `
        <strong>${b.trip_id}</strong> — seats ${Array.from(b.seat_numbers).join(", ")}<br/>
        <span class="status-${b.status}">${b.status}</span> · ${b.passenger_name}
      `;
      if (b.status === "CONFIRMED") {
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => cancelBooking(b.booking_id);
        div.appendChild(cancelBtn);
      }
      el.appendChild(div);
    });
  } catch (err) {
    el.innerHTML = `<p class="message error">${err.message}</p>`;
  }
}

async function cancelBooking(bookingId) {
  try {
    await apiRequest(`/bookings/${bookingId}`, "DELETE", null, true);
    loadMyBookings();
  } catch (err) {
    alert(err.message);
  }
}


function swapLocations() {
  const origin = document.getElementById("origin");
  const destination = document.getElementById("destination");

  const temporaryValue = origin.value;

  origin.value = destination.value;
  destination.value = temporaryValue;
}
