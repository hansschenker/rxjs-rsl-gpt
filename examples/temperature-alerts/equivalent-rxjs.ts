import { filter, from, map } from "rxjs";

const toFahrenheit = (celsius: number) => (celsius * 9) / 5 + 32;
const isHot = (fahrenheit: number) => fahrenheit >= 80;

from([18, 22, 27, 31])
  .pipe(map(toFahrenheit), filter(isHot))
  .subscribe({
    next: (fahrenheit) => {
      console.log(`Hot: ${fahrenheit.toFixed(1)} °F`);
    },
    error: (error: unknown) => {
      console.error("Temperature error:", error);
    },
    complete: () => {
      console.log("Temperature stream complete");
    },
  });
