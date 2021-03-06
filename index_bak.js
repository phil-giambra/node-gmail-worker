#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');


// check if run as a sub-process

let _is_subprocess = true
if (!process.send) { _is_subprocess = false }

// check if run as a module
let _is_module = true
if (require.main === module) { _is_module = false }
//console.log(`module: `, _is_module);

// setup the outputs
let mEmitter
let output
let output_error = []


// check for cmd line options and setup the config location
let altconfig = null
let new_identity = null
let authInfo = { needed:false, id:null, key:null }
let _list_ids = false
let _do_job = false
let job_text = null
let args = process.argv
//console.log("cmd-args", args);
args.forEach((item, i) => {
    // use alternate config location
    if (item === "-c" || item === "/c") { altconfig = args[i+1]}
    // add new identity
    if (item === "-n" || item === "/n") { new_identity = args[i+1]}
    // authorize an identity
    if (item === "-a" || item === "/a") { authInfo.needed = true ;  authInfo.id = args[i+1]; authInfo.key = args[i+2];}
    // list identities
    if (item === "-l" || item === "/l") { _list_ids = true }
    // send mail object
    if (item === "-j" || item === "/j") { _do_job = true ; job_text = args[i+1] }
});

let osuser
let configbase

//console.log(process.platform);
//*** maybe add mac in here too
if (process.platform === 'win32') {
    osuser = process.env.USERNAME
    // for windows we will convert to forward slashes like linux
    if (altconfig === null) {
        configbase = process.env.APPDATA.replace(/\\/g, "/")
    } else {
        configbase = altconfig.replace(/\\/g, "/")
        //console.log("using alt config");
    }

}
else if (process.platform === 'linux') {
    if (altconfig === null) {
        osuser = process.env.USER
        configbase = process.env.HOME + "/" +".config"
    } else {
        configbase = altconfig
        //console.log("using alt config");
    }

}

if ( configbase.endsWith("/") ) { configbase += "node-gmail-worker" } else { configbase += "/node-gmail-worker"}
//console.log( osuser , configbase);


// setup config and identities
// LocalConfig is not used but here for possible future use
let LocalConfig = {}
function saveLocalConfig() {
    fs.writeFileSync(configbase + "/config.json", JSON.stringify(LocalConfig,null,4) )
}


if ( !fs.existsSync( configbase ) ) {
    //console.log("Creating config folder", configbase);
    fs.mkdirSync( configbase, { recursive: true } )
    saveLocalConfig()
} else {
    if (fs.existsSync(configbase + "/config.json")) {
        //console.log('Loading config.json.');
        LocalConfig = JSON.parse( fs.readFileSync(configbase + "/config.json",'utf8') )
    } else {
        saveLocalConfig()
    }

}

// setop message handling for sub-process
if ( _is_subprocess ){
    hookToMainProcess()
}

if ( _is_module ){
    initModule()
}

// Identities can be created with the -n option or setup manually by adding a subfolder to  {configbase}/identities"
// The folder should be named as the users gmail or gsuite address and contain
// an OAuth 2.0 Client ID file named "credentials.json" (see README.md on how to get this file from google ).
// Also an "options.json" file for this identity (see createIdentity for the default_options).
// The script will look for any existing identities and add them to ID
// If no identities exist or any are misconfigured (missing credentials, options or token)
// the script will not process any jobs and exit

// If the scopes change your token will need to be deleted so it can be regenerated
const GmailScopes = ['https://www.googleapis.com/auth/gmail.send']

let IdList = []
let ID = {}
let _ids_ok = true
let _tokens_ok = false

// check for new identity to add
//*** should validate email here
if (new_identity !== null) {
    createIdentity(new_identity.toLowerCase())
}

parseIdentities()


// if any oAuth credentials.json or options.json are missing output an error and exit
if ( _ids_ok === false ) {
    output = { type:"status", value:"error",  errors:output_error }
    if ( _list_ids === true ) { output =  listIdentities()  }
    if (_is_subprocess) { process.send(output) } else { console.log( JSON.stringify(output,null,4) ) }

    process.exit()
}




// start check for existance of token for each identity
if (IdList.length > 0){ testForToken(0) }


if ( _do_job ) {
    // try to parse the json
    try {
        JSON.parse(job_text)
    } catch (e) {
        console.log("Error parsing json string for job");
    } finally {

    }
}


// this will check
function parseIdentities(){
    if ( fs.existsSync( configbase +"/identities") ) {
        let filelist =  fs.readdirSync(configbase +"/identities")
        if (filelist.length === 0) { _ids_ok = false }
        for (var i = 0; i < filelist.length; i++) {
            let id = filelist[i]
            ID[id] = {}
            IdList.push(id)
            if ( fs.existsSync( configbase +"/identities/"+filelist[i]+"/credentials.json" ) ) {
                ID[id].creds = JSON.parse( fs.readFileSync(configbase +"/identities/"+filelist[i]+"/credentials.json",'utf8') )
                ID[id].token_path = configbase +"/identities/"+filelist[i]+"/token.json"

            } else {
                output_error.push(`Error loading client secret file: ${configbase}/identities/${filelist[i]}/credentials.json`)
                output_error.push(`You must place Google OAuth 2.0 client ID credentials at the above location`)
                //console.log(`***\nError loading client secret file: ${configbase}/identities/${filelist[i]}/credentials.json`);
                //console.log(`You must place Google OAuth 2.0 client ID credentials at the above location\n***`);
                _ids_ok = false
            }
            if ( fs.existsSync( configbase +"/identities/"+filelist[i]+"/options.json" ) ) {
                if ( ID[id] ){
                    ID[id].options = JSON.parse( fs.readFileSync(configbase +"/identities/"+filelist[i]+"/options.json",'utf8') )
                }

            } else {
                output_error.push(`***\nError loading options.json file: ${configbase}/identities/${filelist[i]}/options.json`);
                output_error.push(`You must create the file options.json at the above location\n***`);
                //console.log(`***\nError loading options.json file: ${configbase}/identities/${filelist[i]}/options.json`);
                //console.log(`You must create the file options.json at the above location\n***`);
                _ids_ok = false
            }

        }
    } else {
        // create the identities folder if missing
        fs.mkdirSync( configbase+"/identities", { recursive: true } )
        _ids_ok = false
    }

}

function hookToMainProcess() {
    process.on('message', (packet) => {
        console.log('Message from parent process', packet);
          if (packet.type === "auth_reply") {
              handleAuthReply(packet)
          }
          if (packet.type === "job") {
              if ( _tokens_ok === true) {
                  handleJobs(packet)
              } else {
                  // any jobs that can't be completed are returned with error status
                  packet.type = "job_responce"
                  packet.status = "error"
                  process.send(packet)
              }

          }
          else if (packet.type === "exit") {
              process.exit()
          }
          else {
              // for unknow packet types send back as error packet
              packet.type = "error"
              process.send(packet)
              //console.log('Unknown type', packet);
          }
      });
}


function initModule() {
    const EventEmitter = require('events');

    class ModEmitter extends EventEmitter {}

    mEmitter = new ModEmitter();
    exports.auth = handleAuthReply;
    exports.create = createIdentity;
    exports.doJob = handleJobs;
    exports.list = listIdentities;
    exports.msg = mEmitter;

    /*
    mEmitter.on('event', () => {
        console.log('an event occurred!');
    });
    mEmitter.emit('event');
    */
    console.log("NGW Module has been initiated");

}

function testForToken(pos) {
    if (pos > IdList.length - 1 ) {
        // all done checking tokens ready for normal operations
        _tokens_ok = true
        let output = {type:"status", value:"ready"}
        if ( _list_ids === true ) { output = listIdentities()  }
        if (_is_subprocess) { process.send(output) }
        else if ( _is_module  ) {
            mEmitter.emit("status", output)
            setTimeout(function(){
                console.log("emmiting");
                mEmitter.emit("status", output)
            },2000)

        }
        else { console.log( JSON.stringify(output,null,4) ) }
        return
    }
    let id = IdList[pos]
    if (fs.existsSync(ID[id].token_path)){
        ID[id].token = JSON.parse( fs.readFileSync(ID[id].token_path,'utf8') )
        testForToken(pos+1)

    } else {
        //missing token request one
        console.log("missing token requesting one");
        getNewToken(id,pos)
    }
}

function getNewToken(id,pos) {
    // first create an oauth client
    const {client_secret, client_id, redirect_uris} = ID[id].creds.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GmailScopes,
    });
    ID[id].oauth = oAuth2Client
    if ( _is_subprocess === false ) {
        console.log(`Authorize token needed for ${id} open this url in a browser: \n ${authUrl}` );
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            handleAuthReply({type:"auth_reply", identity:id, pos:pos, code: code })
        });

    } else {
        // send request for auth code to main process
        process.send({type:"auth_requested", identity:id, pos:pos, url: authUrl })
    }

}

function handleAuthReply(packet) {
    let id = packet.identity
    let pos = packet.pos
    let oAuth2Client = ID[id].oauth

    oAuth2Client.getToken(packet.code, (err, token) => {
        if (err) return console.error(`Error retrieving access token for ${id}`, err);
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFile(ID[id].token_path, JSON.stringify(token), (err) => {
            if (err) return console.error(err);
            console.log(`Token stored for ${id} at ${ID[id].token_path} `);
            // ok now check the token again
            testForToken(pos)
        });

    });


}

function authorize(id, packet, callback) {
    const {client_secret, client_id, redirect_uris} = ID[id].creds.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(ID[id].token);
    callback(id, packet, oAuth2Client);

}



function emailValid(id){
    //*** set this up ?? maybe put it in createIdentity
    return true
}
// create the folder and options.json for a new identity
function createIdentity(id) {
    let output = {type:"create_identity", status:"done" , errors:[], results:[] }
    if (ID[id]){
        output.status = "error"
        output.errors.push(`Create identity failed: Already exists ${id}  `)
        //console.log();
        //return false
    }
    else if ( !emailValid(id)  ){
        output.status = "error"
        output.errors.push(`Create identity failed: Invalid email address ${id}  `)
    }
    else {
        let path =  configbase+"/identities/"+id
        let default_options = { dname:id , pre_body:"", post_body:"", cc:[] }
        fs.mkdirSync( path , { } )
        fs.writeFileSync(path + "/options.json", JSON.stringify(default_options,null,4) )
        output.results.push(`Identity created for ${id}`)
        output.results.push(`You must place Google OAuth 2.0 client ID credentials at the following location`)
        output.results.push(`${configbase}/identities/${id}/credentials.json`)

    }
    if (_is_subprocess) {
        process.send(output)
    }
    else if (_is_module) {
        return output
    } else {
        console.log(output);
        process.exit()
    }
}


function handleJobs(packet) {
    console.log("Processing job ", packet);
    let id = packet.identity
    if (!ID[id]) {
        console.log("invalid ID job canceled" );
        if (_is_subprocess) {
            packet.type = "job_responce"
            packet.status = "error"
            process.send(packet)
        }
        return
    }
    if (packet.job === "send") {
        authorize(id, packet , sendMail)
    }
}

// returns a array of Identities and their status
function listIdentities() {
    //onsole.table(ID)
    let list = []
    IdList.forEach((item, i) => {
        list.push({id:item})
        list[i].creds = "missing"
        if (ID[item].creds) { list[i].creds = "ok" }
        list[i].options = "missing"
        if (ID[item].options) { list[i].options = "ok" }
        list[i].token = "missing"
        if (_ids_ok === false) { list[i].token = "unknown" }
        if (ID[item].token) { list[i].token = "ok" }
    });

    return list
}

async function sendMail(id, packet, auth) {
    // You can use UTF-8 encoding for the subject using the method below.
    // You can also just use a plain string if you don't need anything fancy.
    let data = packet.data
    const gmail = google.gmail({version: 'v1', auth:auth});
    const subject = data.subject;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    // replace any missing options from default options
    if (!data.options) { data.options = {}  }
    for (let opt in ID[id].options) {
        if (!data.options[opt]) { data.options[opt] = ID[id].options[opt]  }
    }
    const messageParts = [
        `From: ${data.options.dname} <${id}>`,
        `To: ${data.toName} <${data.toAddr}>`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        `${data.options.pre_body}`,
        `${data.body}`,
        `${data.options.post_body}`,
    ];
    const message = messageParts.join('\n');

    // The body needs to be base64url encoded.
    const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: encodedMessage,
        },
    });
    console.log("got responce from gmail",res); //res.data
    if (_is_subprocess === true) {
        packet.type = "job_responce"
        packet.status = "done"
        packet.res = res
        // send the packet back to the main process
        process.send(packet)
    }
    //return res.data;
}
