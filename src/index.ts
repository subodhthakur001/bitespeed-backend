import express from "express";
import identifyRouter from "./routes/identify";

const app = express();
app.use(express.json());
app.use("/identify", identifyRouter);

// export app for testing
export { app };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}
