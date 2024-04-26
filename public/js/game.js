const socket = io();
let clientId = null;
let gameId = null;
let charSelected = null;

socket.on("CONNECTION_ACK", (data) => {
  const { clientId: client } = JSON.parse(data);
  clientId = client;
});

// Emit event when user submits the form
function performAction(username, gamename) {
  if (username && gamename) {
    //* When a new user joins a game
    socket.emit(
      "JOIN_GAME",
      { clientId, username, gamename },
      ({ err, data }) => {
        if (err) {
          alert(err);
          location.href = "/"; // Re-route to index.html
          console.error(err);
        } else {
          console.info(`data, ${JSON.stringify(data, null, 2)}`);
          const { clientDetails, gameData } = data;
          const { gameBoard, gameId: id } = gameData;
          gameId = id;
          displayGrid(gameBoard);
        }
      }
    );
  } else if (username && !gamename) {
    //* When a new user creates a game
    socket.emit("CREATE_GAME", { clientId, username }, ({ err, data }) => {
      if (err) {
        alert(err);
        location.href = "/"; // Re-route to index.html
        console.error(err);
      } else {
        console.info(`data, ${JSON.stringify(data, null, 2)}`);
        const { clientDetails, gameData } = data;
        const { gameBoard, gameId: id } = gameData;
        gameId = id;
        displayGrid(gameBoard);
      }
    });
  }
}

function displayGrid(data) {
  // Remove the landing page content
  const landingPage = document.getElementById("landingPage");
  landingPage.innerHTML = "";

  // Create the grid container
  const gridContainer = document.createElement("div");
  gridContainer.className = "centered-form__box grid-container";
  landingPage.appendChild(gridContainer);

  for (let col = 0; col < 5; col++) {
    // Iterate over columns first
    for (let row = 0; row < 5; row++) {
      // Then iterate over rows
      const index = row * 5 + col; // Calculate index based on column-major order

      const button = document.createElement("button");
      button.className = "grid-item"; // Apply the grid-item class
      button.textContent = data[index] || ""; // Set the button text
      if (index === 12) {
        button.disabled = true;
        button.textContent = "X";
      } else {
        button.addEventListener("click", () => {
          // Handle button click here
          console.log(`Button ${index} clicked`);

          // Disable all buttons
          disableButtons();

          // Emit an event to the server with the button text content
          const buttonText = button.textContent.trim(); // Get the text content of the button
          socket.emit("NUMBER_SELECTED", { buttonText });

          // Wait for acknowledgment from the server before enabling buttons
          socket.on("ACKNOWLEDGMENT", () => {
            enableButtons();
          });
        });
      }

      gridContainer.appendChild(button);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const gameForm = document.getElementById("gameForm");

  gameForm.addEventListener("submit", (event) => {
    event.preventDefault(); // Prevent default form submission

    const formData = new FormData(gameForm);
    const username = formData.get("username");
    const gamename = formData.get("gamename");

    if (event.submitter.textContent === "1. Create Game") {
      performAction(username);
    } else {
      if (!gamename) {
        alert(`Game Id has to be provided`);
        location.href = "/"; // Re-route to index.html - so performction() is not executed
        console.error(`Game Id not provided`);
      }
      performAction(username, gamename);
    }
  });
});

function disableButtons() {
  const buttons = document.querySelectorAll(".grid-item");
  buttons.forEach((button) => {
    button.disabled = true;
  });
}

function enableButtons() {
  const buttons = document.querySelectorAll(".grid-item");
  buttons.forEach((button) => {
    button.disabled = false;
  });
}
