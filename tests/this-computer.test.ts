import { describe, expect, test } from "bun:test";
import { leadsToThisComputer, namesThisComputer } from "../shared/this-computer.ts";

const hostOf = (address: string) => new URL(address).hostname;

describe("an address of this computer", () => {
  test("is localhost and any name under it, 127.0.0.0/8 and 0.0.0.0/8 in any form the URL parser takes, and the IPv6 addresses carrying them", () => {
    const ofThisComputer = [
      "http://localhost/",
      "http://LOCALHOST:4600/",
      "http://localhost./",
      "http://foo.localhost/",
      "http://foo.localhost./",
      "http://127.0.0.1:4600/",
      "http://127.1/",
      "http://127.255.255.254/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://017700000001/",
      "http://127.0.0.1./",
      "http://0.0.0.0/",
      "http://0/",
      "http://[::1]/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[::]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::ffff:0.0.0.0]/",
      "http://[::127.0.0.1]/",
    ];
    expect(ofThisComputer.filter((address) => !namesThisComputer(hostOf(address)))).toEqual([]);
  });

  test("is no other host, however close its name", () => {
    const elsewhere = [
      "https://example.com/",
      "http://192.168.1.20:8080/",
      "http://10.0.0.1/",
      "http://128.0.0.1/",
      "http://1.0.0.127/",
      "http://localhost.example.com/",
      "http://notlocalhost/",
      "http://[::ffff:10.0.0.1]/",
      "http://[2001:db8::1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[fe80::1]/",
    ];
    expect(elsewhere.filter((address) => namesThisComputer(hostOf(address)))).toEqual([]);
  });

  test("is also any name this computer's Mirador is reached by", () => {
    expect(leadsToThisComputer(new URL("https://macbook.example.ts.net:4600/x"), ["macbook.example.ts.net"])).toBe(true);
    expect(leadsToThisComputer(new URL("https://MACBOOK.example.ts.net./x"), ["macbook.example.ts.net"])).toBe(true);
    expect(leadsToThisComputer(new URL("https://example.com/"), ["macbook.example.ts.net"])).toBe(false);
    expect(leadsToThisComputer(new URL("http://127.1/"), [])).toBe(true);
  });
});
