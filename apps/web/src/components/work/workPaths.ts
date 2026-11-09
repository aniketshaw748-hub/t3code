/** Work mode owns `/work` and everything under it. */
export const isWorkPath = (pathname: string) =>
  pathname === "/work" || pathname.startsWith("/work/");
