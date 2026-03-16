export class CheckIpService {
  public convertIP = (ip: string): number => {
    const components = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

    if (components) {
      let long = 0;
      let power = 1;

      for (let i = 4; i >= 1; i -= 1) {
        long += power * Number(components[i]);
        power *= 256;
      }
      return long;
    }
    return -1;
  };

  public isCorrectIP = (ip: string, subnet: string): boolean => {
    const mask = subnet.match(/^(.*?)\/(\d{1,2})$/) as RegExpMatchArray;
    const baseIP = this.convertIP(mask[1]);
    const targetIP = this.convertIP(ip);

    if (mask && baseIP >= 0) {
      const freedom = 2 ** (32 - Number(mask[2]));

      return (targetIP > baseIP) && (targetIP < baseIP + freedom - 1);
    }

    return false;
  };
}
