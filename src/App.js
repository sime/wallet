import './App.css'

import { useState } from 'react'
import {
  HashRouter as Router,
  Switch,
  Route,
  Redirect
} from 'react-router-dom'
import { MdDashboard, MdLock, MdCompareArrows } from 'react-icons/md'
import { BsPiggyBank } from 'react-icons/bs'
import EmailLogin from './components/EmailLogin/EmailLogin'
import AddAccount from './components/AddAccount/AddAcount'
import { useEffect, useCallback } from 'react'

import WalletConnect from '@walletconnect/client'
import { getDefaultProvider } from 'ethers'
import { Bundle } from 'adex-protocol-eth/js'

const useWalletConnect = ({ selectedAcc, chainId }) => {
  const LOCAL_STORAGE_URI_KEY = 'ambireAppWcUri'

  //const { safe, sdk } = useSafeAppsSDK();
  const [wcClientData, setWcClientData] = useState(null)
  const [connector, setConnector] = useState()

  const wcDisconnect = async () => {
    if (connector) connector.killSession();
    localStorage.removeItem(LOCAL_STORAGE_URI_KEY)
    setConnector(undefined)
    setWcClientData(null)
  }

  const wcConnect =
    async (uri) => {
      console.log('starting conn', uri)
      const wcConnector = new WalletConnect({ uri })
      setConnector(wcConnector)
      setWcClientData(wcConnector.peerMeta)
      localStorage.setItem(LOCAL_STORAGE_URI_KEY, uri)

      wcConnector.on('session_request', (error, payload) => {
        console.log('wc session request; here we get the client data', payload)

        console.log(selectedAcc)
        wcConnector.approveSession({
          accounts: [selectedAcc],
          chainId: chainId,
        });

        setWcClientData(payload.params[0].peerMeta);
      })

      wcConnector.on('call_request', async (error, payload) => {
        console.log(error, payload)
        if (error) {
          throw error;
        }

        try {
          let result = '0x';

          switch (payload.method) {
            case 'eth_sendTransaction': {
              // @TODO network specific
              const provider = getDefaultProvider('https://polygon-rpc.com/rpc')
              const rawTxn = payload.params[0]
              // @TODO: add a subtransaction that's supposed to `simulate` the fee payment so that
              // we factor in the gas for that
              const bundle = new Bundle({
                network: 'polygon', // @TODO
                identity: selectedAcc,
                // @TODO: take the gasLimit from the rawTxn
                // @TODO "|| '0x'" where applicable
                txns: [[rawTxn.to, rawTxn.value, rawTxn.data]],
                signer: { address: localStorage.tempSigner } // @TODO
              })
              console.log(await bundle.estimate({ relayerURL, fetch: window.fetch }))
              // @TODO relayerless mode
              break;
            }
            case 'gs_multi_send': {
              // @TODO WC
              break;
            }

            case 'personal_sign': {
              // @TODO WC
              break;
            }

            case 'eth_sign': {
              // @TODO WC
              break;
            }
            default: {
              wcConnector.rejectRequest({ id: payload.id, error: { message: 'METHOD_NOT_SUPPORTED' }});
              break;
            }
          }

          wcConnector.approveRequest({
            id: payload.id,
            result,
          })
        } catch (err) {
          wcConnector.rejectRequest({ id: payload.id, error: { message: err.message }})
        }
      })

      wcConnector.on('disconnect', (error, payload) => {
        if (error) throw error
        wcDisconnect()
      })
    }

  // @TODO: WC: no?
  /*
  useEffect(() => {
    if (!connector) {
      const uri = localStorage.getItem(LOCAL_STORAGE_URI_KEY)
      if (uri) wcConnect(uri)
    }
  }, [connector, wcConnect])
  */

  return { wcClientData, wcConnect, wcDisconnect }
}

// @TODO consts/cfg
const relayerURL = 'http://localhost:1934'

function useAccounts () {
  const [accounts, setAccounts] = useState(() => {
    // @TODO catch parse failures and handle them
    try {
      return JSON.parse(localStorage.accounts || '[]')
    } catch (e) {
      console.error('accounts parsing failure', e)
      return []
    }
  })
  const [selectedAcc, setSelectedAcc] = useState(() => {
    const initialSelectedAcc = localStorage.selectedAcc
    if (!initialSelectedAcc || !accounts.find(x => x._id === initialSelectedAcc)) {
      return accounts[0] ? accounts[0]._id : ''
    }
    return initialSelectedAcc
  })

  const onSelectAcc = selected => {
    localStorage.selectedAcc = selected
    setSelectedAcc(selected)
  }
  const onAddAccount = (acc, opts) => {
    console.log('onAddAccount', acc)
    const existingIdx = accounts.findIndex(x => x._id.toLowerCase() === acc._id.toLowerCase())

    // @TODO show toast
    // the use case for updating the entry is that we have some props (such as which EOA controls it) which migth change
    if (existingIdx === -1) accounts.push(acc)
    else accounts[existingIdx] = acc

    // need to make a copy, otherwise no rerender
    setAccounts([ ...accounts ])

    localStorage.accounts = JSON.stringify(accounts)

    if (opts.select) onSelectAcc(acc._id)
    if (Object.keys(accounts).length) {
      window.location.href = '/#/dashboard'
    }
  }
  return { accounts, selectedAcc, onSelectAcc, onAddAccount }
}

function App() {
  const { accounts, selectedAcc, onSelectAcc, onAddAccount } = useAccounts()
  // @TODO: WC: this is making us render App twice even if we do not use it
  const { wcClientData, wcConnect, wcDisconnect } = useWalletConnect({ selectedAcc, chainId: 137 })

  const query = new URLSearchParams(window.location.href.split('?').slice(1).join('?'))
  const wcUri = query.get('uri')
  useEffect(() => {
    // @TODO: WC: this is async
    if (wcUri) wcConnect(wcUri)
    //wcDisconnect()
  }, [/* we only wanna handle this at startup */])

  return (
    <Router>
      {/*<nav>
              <Link to="/email-login">Login</Link>
      </nav>*/}

      <Switch>
        <Route path="/add-account">
          <AddAccount relayerURL={relayerURL} onAddAccount={onAddAccount}></AddAccount>
        </Route>

        <Route path="/email-login">
          <EmailLogin relayerURL={relayerURL} onAddAccount={onAddAccount}></EmailLogin>
        </Route>

        <Route path="/dashboard">
          <section id="dashboard">
            <div id="sidebar">
              <div className="logo"/>

              <div className="balance">
                <label>Balance</label>
                <div className="balanceDollarAmount"><span className="dollarSign highlight">$</span>999<span className="highlight">.00</span></div>
              </div>

             {/* TODO proper navi, programmatic selected class */}
              <div className="item selected"><MdDashboard size={30}/>Dashboard</div>
              <div className="item"><MdLock size={30}/>Security</div>
              <div className="item"><MdCompareArrows size={30}/>Transactions</div>
              <div className="item"><BsPiggyBank size={30}/>Earn</div>

            </div>

            <div>
              <select id="accountSelector" onChange={ ev => onSelectAcc(ev.target.value) } defaultValue={selectedAcc}>
                {accounts.map(acc => (<option key={acc._id}>{acc._id}</option>))}
              </select>

              <select id="networkSelector" defaultValue="Ethereum">
                <option>Ethereum</option>
                <option>Polygon</option>
              </select>
            </div>
          </section>
        </Route>
        <Route path="/security"></Route>
        <Route path="/transactions"></Route>
        <Route path="/swap"></Route>
        <Route path="/earn"></Route>
        {/* TODO: connected dapps */}
        {/* TODO: tx identifier in the URL */}
        <Route path="/approve-tx"></Route>

        <Route path="/">
          <Redirect to="/add-account" />
        </Route>

      </Switch>
    </Router>
    )
}

export default App;
