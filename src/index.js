process.loadEnvFile();
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { insertData, getHashData } from "./utils/db.js";

const colors = ["green", "blue"];
let currentBingoNo = null;

const app = express();
const server = createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.static(join(__dirname, `../public`)));

io.on("connection", async (socket) => {
  console.log(`a user connected with connection : ${socket.id}`);
  // await insertData("connectionId", socket.id);

  //* Generate a new clientId
  const clientId = uuidv4();
  const clients = (await getHashData("clients")) || {};

  clients[clientId] = JSON.stringify({
    connectionId: socket.id,
  });

  //Insert new client details in redis
  await insertData("clients", clients);

  const connectionPayload = {
    clientId: clientId,
  };
  socket.emit("CONNECTION_ACK", JSON.stringify(connectionPayload));

  socket.on("CREATE_GAME", async (data, callback) => {
    const { clientId, username } = data;

    //Iterate through clients & validate
    const res = await updateUserName(clientId, username);
    if (res.err) {
      return callback(res);
    }

    const gameRes = await createGame(socket, clientId);
    if (gameRes.err) {
      return callback(gameRes);
    }
    console.log(`New Game created`);

    //* Store gameboard for this user in Redis
    if (gameRes.gameId && gameRes.gameBoard) {
      await insertData(
        `${gameRes.gameId}-${clientId}-board`,
        gameRes.gameBoard
      );
    }

    callback({
      data: {
        clientDetails: res.clientDetails,
        gameData: gameRes,
      },
    });
  });

  socket.on("JOIN_GAME", async (data, callback) => {
    const { clientId, username, gamename: gameId } = data;

    //Iterate through clients & validate
    const res = await updateUserName(clientId, username);
    if (res.err) {
      return callback(res);
    }

    const gameRes = await joinGame(socket, clientId, gameId);
    if (gameRes.err) {
      return callback(gameRes);
    }

    //* Store gameboard for this user in Redis
    if (gameRes.gameId && gameRes.gameBoard) {
      await insertData(
        `${gameRes.gameId}-${clientId}-board`,
        gameRes.gameBoard
      );
    }

    callback({
      data: {
        clientDetails: res.clientDetails,
        gameData: gameRes,
      },
    });

    //Check to see if game can be started > broadcast bingoNo
    currentBingoNo = await updateGameStarted(gameId);
    if (currentBingoNo) {
      io.to(gameId).emit("BINGO_NUMBER", {
        bingoNumber: currentBingoNo,
      });

      //TODO: Start the cron here
      setTimeout(() => {
        sendBingo(io, gameId);
      }, 3000);
    }
  });

  socket.on("NUMBER_SELECTED", async (data, callback) => {
    const { buttonText: number } = data;
    console.log(`No selected by user : ${number}`);

    //TODO: check if no is part of board or not
    if (parseInt(buttonText) === currentBingoNo) {
      callback({
        success: "No is bingo no",
      });
    }

    //TODO: check for row, col, digonals for bingo

    callback();
  });

  socket.on("disconnect", async () => {
    // const con = await getData("connectionId");
    // await deleteData("connectionId");
    console.log(`user disconnected with id : ${socket.id}`);
  });
});

server.listen(process.env.PORT, async () => {
  // await insertColors(colors);
  console.log(`server running at http://localhost:${process.env.PORT}`);
});

async function createGame(socket, clientId) {
  try {
    const gameId = uuidv4();
    const games = (await getHashData("games")) || {};

    const gameObj = {
      clients: [clientId],
      state: "CREATED", // "CREATED", "ONGOING", "FINISHED"
      gameWins: {
        [clientId]: 0,
      },
      winner: null,
    };

    games[gameId] = JSON.stringify(gameObj);
    await insertData("games", games);

    const userColor = colors[gameObj.clients.length - 1];

    socket.join(gameId);

    //Design gameBoard and return to user
    return {
      gameId,
      userColor,
      gameBoard: designGameBoard(),
    };
  } catch (error) {
    return {
      err: error.message || `500: Some unexpected error`,
    };
  }
}

async function updateUserName(clientId, username) {
  const rawData = await getHashData("clients", clientId);
  const clientDetails = rawData ? JSON.parse(rawData) : null;
  if (!clientDetails) {
    return {
      err: "Invlid clientId",
    };
  }

  const clients = (await getHashData("clients")) || {};

  clientDetails.username = username;
  clients[clientId] = JSON.stringify(clientDetails);

  await insertData("clients", clients);
  return { clientDetails };
}

async function joinGame(socket, clientId, gameId) {
  const rawData = await getHashData("games", gameId);
  const gameDetails = rawData ? JSON.parse(rawData) : null;
  if (!gameDetails) {
    return {
      err: "Invlid gameId",
    };
  }

  if (gameDetails.state === "FINISHED") {
    return {
      err: "Game has already finished",
    };
  }

  if (gameDetails.clients?.length === 2) {
    return {
      err: "Maximum participants for a game reached!",
    };
  }

  if (gameDetails.clients.find((c) => c === clientId)) {
    return {
      err: "Client is already part of the game!",
    };
  }

  gameDetails.clients?.push(clientId);
  gameDetails.gameWins.clientId = 0;

  //If clients = 2, start the game and emit an event - return something

  const games = (await getHashData("games")) || {};
  games[gameId] = JSON.stringify(gameDetails);

  await insertData("games", games);

  const userColor = colors[gameDetails.clients.length - 1];

  socket.join(gameId);

  //Design gameBoard and return to user
  return {
    gameId,
    userColor,
    gameBoard: designGameBoard(),
  };
}

async function updateGameStarted(gameId) {
  const rawData = await getHashData("games", gameId);
  const gameDetails = JSON.parse(rawData);

  if (gameDetails.clients.length === 2 && gameDetails.state === "CREATED") {
    // send a random Bingo number to client -> start the cron
    const bingoNo = getRandomInt(1, 100);

    const games = (await getHashData("games")) || {};
    gameDetails.state = "ONGOING";
    games[gameId] = JSON.stringify(gameDetails);

    await insertData("games", games);

    return bingoNo;
  }

  return null;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function designGameBoard() {
  let begin = 0;
  let range = 20;
  let end = begin + range;
  let startIndex = 0;
  const gameBoard = {};

  for (let i = 0; i < 5; i++) {
    let numbers = 5;

    while (numbers > 0) {
      const randomNo = getRandomInt(begin, end);
      if (startIndex === 12) {
        gameBoard[startIndex++] = null;
      } else {
        gameBoard[startIndex++] = randomNo;
      }
      numbers--;
    }

    begin = end;
    end += range;
  }

  return gameBoard;
}

function sendBingo(io, gameId) {
  currentBingoNo = getRandomInt(1, 100);
  console.log("sending new bingoNo..", bingoNo);
  io.to(gameId).emit("BINGO_NUMBER", {
    bingoNumber: currentBingoNo,
  });

  setTimeout(() => {
    sendBingo(io, gameId);
  }, 3000);
}

function testSpecific(gameId) {
  const boards = [];
}
