import handler from "./pages/api/verify_race.js";

const req = {
  method: "POST",
  headers: {
    host: "localhost:3000",
    "x-forwarded-proto": "http",
  },
  body: {
    track: "Aqueduct",
    date: "2025-11-22",
    raceNo: "1",
    predicted: { win: "", place: "", show: "" },
  },
};

const res = {
  statusCode: 200,
  headers: {},
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(key, value) {
    this.headers[key] = value;
    return this;
  },
  json(payload) {
    this.payload = payload;
    console.log(
      JSON.stringify(
        {
          statusCode: this.statusCode,
          step: payload?.step,
          ok: payload?.ok,
          summary: payload?.summary,
        },
        null,
        2,
      ),
    );
    return this;
  },
};

await handler(req, res);



