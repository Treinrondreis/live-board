import {startCmsAdminPreview} from '../test-fixtures/cms-admin-preview.mjs';
const preview=await startCmsAdminPreview({port:Number(process.env.PORT||8795)});
console.log('Treinreiziger beheer met fictieve gegevens: '+preview.origin+'/seinhuis/treinreiziger');
