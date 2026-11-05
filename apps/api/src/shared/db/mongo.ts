import mongoose from "mongoose";

export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
