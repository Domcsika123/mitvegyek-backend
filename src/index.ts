import dotenv from "dotenv";
dotenv.config(); // EZ LEGYEN TÉNYLEG A LEGBÖLÖN!!!

import app from "./app";

const PORT = Number(process.env.PORT || 3001);

// Itt indítjuk el a szervert
app.listen(PORT, () => {
  console.log(`🚀 Backend fut itt: http://localhost:${PORT}`);
});
