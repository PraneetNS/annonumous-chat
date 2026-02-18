import { Suspense } from "react";
import JoinClient from "./JoinClient";

export default function JoinPage() {
  return (
    <Suspense>
      <JoinClient />
    </Suspense>
  );
}

