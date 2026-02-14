import { createApp } from "./app";
import { env } from "./config/env";
import { AppDataSource } from "./config/data-source";

const boot = async (): Promise<void> => {
  await AppDataSource.initialize();
  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on ${env.PORT}`);
  });
};

void boot();
