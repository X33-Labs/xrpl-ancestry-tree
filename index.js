var xrpl = require("xrpl");
var fs = require('fs');


var publicServer = "wss://s1.ripple.com/"; //RPC server
var parentAddress = "rKhTJsxmUS5HTCWBhZVo9oD5D8HNMAmYU";
var throttle = 0.5 //Number of seconds to throttle each request
var minLedgerIndex = -1 //This will get updated automatically to the Parent's genesis ledger
var maxLevels = 3 //Max levels to traverse




var AncestryTree ={
    Parent: parentAddress,
    children: []
}

const TransactionPayload = {
      command: "account_tx",
      account: "",
      forward: true
  }

function addElements(lineObject, transactions)
{
    for(let i = 0; i < transactions.length; i++)
    {
        lineObject.push(transactions[i].tx);
    }
    return lineObject;
}

async function ProcessData(client, rootAccountAddress, node, level) {
    console.log('Starting Processing on level ' + level.toString());
    var AddressList = []
    let lines = [];
    let marker = undefined;
    let accountTxns = await getAccountTransactions(client,marker,rootAccountAddress);
    marker = accountTxns.marker;
    console.log('transactions: ' + accountTxns.transactions.length + ' for address ' + rootAccountAddress);
    if(accountTxns.transactions.length > 0)
    {
        lines = addElements(lines,accountTxns.transactions)
    }
    while (marker != undefined) {
        await new Promise((r) => setTimeout(r, throttle * 1000));
        console.log('calling get transactions');
        accountTxns = await getAccountTransactions(client, marker,rootAccountAddress);
        if(accountTxns.transactions.length > 0)
        {
            console.log('adding: ' + accountTxns.transactions.length);
            console.log('total so far: ' + lines.length)
            lines = addElements(lines,accountTxns.transactions)
        }
        marker = accountTxns.marker;
    }
    console.log('total lines: ' + lines.length)
    for (let i = 0; i < lines.length; i++) {
        if(lines[i].TransactionType == 'Payment')
        {
            if(!AddressList.includes(lines[i].Destination))
            {
                AddressList.push(lines[i].Destination);
                console.log('checking: ' + lines[i].Destination)
                if(await checkIfCreatedByParent(rootAccountAddress,lines[i].Destination,client) == true)
                {
                    console.log('found child ' + lines[i].Destination);
                    let tn = {
                        Address: "",
                        TransactionHash: "",
                        children: []
                    }
                    tn.Address = lines[i].Destination;
                    tn.TransactionHash = lines[i].hash;
                    if((level + 1) <= maxLevels)
                    {
                        let n = await ProcessData(client, tn.Address, tn, level + 1);
                        node.children.push(n);
                    } else {
                        node.children.push(tn);
                    }
                }
            }
        }
    }
    return node;
}

async function getAccountTransactions(client, marker, address) {
    var request = TransactionPayload;
    request.account = address;
    request.limit = 200;
    request.ledger_index_min = minLedgerIndex;
    if (marker != undefined) {
      request.marker = marker;
    }
    const response = await client.request(request);
    return response.result;
}

async function checkIfCreatedByParent(parentAddress, childAddress, client) {
    var request = TransactionPayload;
    request.account = childAddress;
    request.limit = 1;
    request.marker = undefined;
    request.ledger_index_min = minLedgerIndex;
    await new Promise((r) => setTimeout(r, throttle * 1000));
    const response = await client.request(request);
    if(response.result.transactions.length > 0)
    {
        if(response.result.transactions[0].tx.TransactionType == 'Payment')
        {
            if(response.result.transactions[0].tx.Account == parentAddress && response.result.transactions[0].tx.Destination == childAddress)
            {
                return true;
            }
        }
    }
    return false;
}

async function UpdateParentGenesisLedger(client, address) {
    var request = TransactionPayload;
    request.account = address;
    request.limit = 1;
    const response = await client.request(request);
    minLedgerIndex = response.result.transactions[0].tx.ledger_index;
}

async function main() {
    const client = new xrpl.Client(publicServer);
  try {
    console.log("Starting to Process");
      let marker = undefined;
      await client.connect();
      await UpdateParentGenesisLedger(client,parentAddress)
      let totalTree = await ProcessData(client, parentAddress, AncestryTree, 1);
      fs.writeFile('output.txt', JSON.stringify(totalTree, null, "\t"), () => {});
      console.log("Finished! Check output.txt");
    } catch(err)
    {
        console.log(err);
    } finally{
        await client.disconnect();
    }

}

main();