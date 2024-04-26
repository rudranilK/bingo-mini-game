process.loadEnvFile();
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { insertData, getHashData } from "./utils/db.js";

const gameBoards = [
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
    12: null,
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
    12: null,
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

const app = express();
const server = createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.static(join(__dirname, `../public`)));

io.on("connection", async (socket) => {
  console.log("a user connected");
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

    callback({
      data: {
        clientDetails: res.clientDetails,
        gameData: gameRes,
      },
    });
  });

  socket.on("disconnect", async () => {
    // const con = await getData("connectionId");
    // await deleteData("connectionId");
    console.log(`user disconnected with id : ${"abc"}`);
  });
});

server.listen(process.env.PORT, async () => {
  console.log(`server running at http://localhost:${process.env.PORT}`);
});

async function createGame(socket, clientId) {
  try {
    const gameId = uuidv4();
    const games = (await getHashData("games")) || {};

    games[gameId] = JSON.stringify({
      clients: [clientId],
      state: "CREATED", // "CREATED", "ONGOING", "FINISHED"
      gameWins: {
        [clientId]: 0,
      },
      winner: null,
    });
    await insertData("games", games);

    socket.join(gameId);

    //Design gameBoard and return to user
    return {
      gameId,
      gameBoard: gameBoards[0],
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

  socket.join(gameId);

  //Design gameBoard and return to user
  return {
    gameId,
    gameBoard: gameBoards[1],
  };
}
