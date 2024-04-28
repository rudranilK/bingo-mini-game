process.loadEnvFile();
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { insertData, getHashData } from "./utils/db.js";

//! Temporry
const gameboards = [
  {
    0: 14,
    1: 6,
    2: 3,
    3: 19,
    4: 17,
    5: 30,
    6: 21,
    7: 25,
    8: 35,
    9: 40,
    10: 55,
    11: 43,
    12: 58,
    13: 59,
    14: 54,
    15: 78,
    16: 82,
    17: 75,
    18: 64,
    19: 61,
    20: 89,
    21: 98,
    22: 91,
    23: 99,
    24: 83,
  },
  {
    0: 5,
    1: 19,
    2: 12,
    3: 4,
    4: 18,
    5: 22,
    6: 33,
    7: 25,
    8: 36,
    9: 38,
    10: 46,
    11: 51,
    12: 55,
    13: 60,
    14: 53,
    15: 74,
    16: 76,
    17: 68,
    18: 64,
    19: 72,
    20: 81,
    21: 94,
    22: 98,
    23: 91,
    24: 87,
  },
];
//! remove after testing

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

    //* Store gameboard for this user in Redis
    if (gameRes.gameId && gameRes.gameBoard) {
      await insertData(
        `${gameRes.gameId}-${clientId}-board`,
        gameRes.gameBoard
      );
    }

    console.log(`A user created game ${gameRes.gameId}`);

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

    console.log(`A user joined game ${gameId}`);

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
      }, 6000);
    }
  });

  socket.on("NUMBER_SELECTED", async (data, callback) => {
    const { buttonText: number, clientId, gameId } = data;
    console.log(`No selected by user : ${number}`);

    //TODO: check if no is part of board or not
    if (parseInt(number) === currentBingoNo) {
      callback({
        data: {
          success: "No is bingo no",
        },
      });
    }

    //TODO: check for row, col, digonals for bingo

    // callback();  //! Enable this after testing
  });

  socket.on("disconnect", async () => {
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
      // gameBoard: designGameBoard(),  //* Uncomment this
      gameBoard: gameboards[0], //! Remove this after testing
    };
  } catch (error) {
    return {
      err: error.message || `500: Some unexpected error`,
    };
  }
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
    // gameBoard: designGameBoard(), //* Uncomment this
    gameBoard: gameboards[1], //! Remove this after testing
  };
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

async function updateGameStarted(gameId) {
  const rawData = await getHashData("games", gameId);
  const gameDetails = JSON.parse(rawData);

  if (gameDetails.clients.length === 2 && gameDetails.state === "CREATED") {
    // send a random Bingo number to client
    // const bingoNo = getRandomInt(1, 100);  //* Uncomment this
    const bingoNo = testSpecific(); //! Remove this after testing

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
  // currentBingoNo = getRandomInt(1, 100); //* Uncomment this

  currentBingoNo = testSpecific(); //! Remove after testing

  console.log("sending new bingoNo..", currentBingoNo);
  io.to(gameId).emit("BINGO_NUMBER", {
    bingoNumber: currentBingoNo,
  });

  setTimeout(() => {
    sendBingo(io, gameId);
  }, 6000);
}

function testSpecific() {
  const values = [
    ...Object.values(gameboards[0]),
    ...Object.values(gameboards[1]),
  ];

  const position = getRandomInt(0, values.length - 1);
  return values[position];
}
