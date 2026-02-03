const express = require("express");
const cors = require("cors");
const { createPublicClient, defineChain, http, parseAbi } = require("viem");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const rpcUrl = process.env.CRONOS_TESTNET_RPC_URL || "https://evm-t3.cronos.org";
const contractAddress = process.env.CONTRACT_ADDRESS;
const port = process.env.PORT || 4000;

const cronosTestnet = defineChain({
  id: 338,
  name: "Cronos Testnet",
  nativeCurrency: { name: "Cronos", symbol: "tCRO", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: "Cronos Testnet Explorer", url: "https://explorer.cronos.org/testnet" },
  },
});

const client = createPublicClient({ chain: cronosTestnet, transport: http(rpcUrl) });

const votingAbi = parseAbi([
  "function totalPolls() view returns (uint256)",
  "function getPoll(uint256 pollId) view returns (string title, string description, string[] options, uint256[] votes, uint64 startTime, uint64 endTime, bool active, address creator)",
  "function hasAddressVoted(uint256 pollId, address voter) view returns (bool)",
]);

function deriveState(poll) {
  const now = Math.floor(Date.now() / 1000);
  if (!poll.active) return "closed";
  if (now < poll.startTime) return "scheduled";
  if (poll.endTime !== 0 && now > poll.endTime) return "ended";
  return "live";
}

async function readPoll(pollId) {
  const [title, description, options, votes, startTime, endTime, active, creator] =
    await client.readContract({
      address: contractAddress,
      abi: votingAbi,
      functionName: "getPoll",
      args: [BigInt(pollId)],
    });

  const poll = {
    id: pollId,
    title,
    description,
    options,
    votes: votes.map((v) => Number(v)),
    startTime: Number(startTime),
    endTime: Number(endTime),
    active,
    creator,
  };

  return { ...poll, state: deriveState(poll) };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/polls", async (_req, res) => {
  if (!contractAddress) {
    return res.status(500).json({ error: "Missing CONTRACT_ADDRESS in .env" });
  }

  try {
    const total = Number(
      await client.readContract({ address: contractAddress, abi: votingAbi, functionName: "totalPolls" })
    );

    const ids = Array.from({ length: total }, (_, i) => i);
    const polls = await Promise.all(ids.map((id) => readPoll(id)));

    res.json({ total, polls, chainId: cronosTestnet.id, rpcUrl });
  } catch (err) {
    console.error("/polls", err);
    res.status(500).json({ error: "Unable to read polls", details: err.message });
  }
});

app.get("/polls/:id", async (req, res) => {
  if (!contractAddress) {
    return res.status(500).json({ error: "Missing CONTRACT_ADDRESS in .env" });
  }

  const pollId = Number(req.params.id);

  try {
    const poll = await readPoll(pollId);
    res.json(poll);
  } catch (err) {
    console.error(`/polls/${pollId}`, err);
    res.status(500).json({ error: "Unable to read poll", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Backend dang chay o http://localhost:${port}`);
});
