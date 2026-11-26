/** an API answer that wasn't 2xx: `{ error, code }` from src/lib/points/http.ts */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
