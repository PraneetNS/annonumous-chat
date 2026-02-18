
import * as selfsigned from 'selfsigned';
console.log('Module exports:', selfsigned);
try {
    // @ts-ignore
    console.log('Default export:', selfsigned.default);
} catch { }
