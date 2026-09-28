import Shell from './Shell';
import { info } from './info';
import ShiftHandover from './ShiftHandover';

export default function App() {
 return <Shell info={info} repo="entrega-de-turno" page="entrega-de-turno">{lang => <ShiftHandover lang={lang}/>}</Shell>;
}
